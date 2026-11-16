import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { vi } from 'vitest';
import { prisma } from '../../src/db.js';
import app from '../../src/app.js';
import * as paystackMocks from '../../src/utils/paystack.js';
import * as emailMocks from '../../src/utils/email.js';
import { encrypt } from '../../src/utils/encryption.js';

export { prisma, app, paystackMocks, emailMocks };

let counter = 0;
function uniqueId() {
  return ++counter + '_' + Date.now();
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "DisputeEvidence", 
      "DisputeMessage", 
      "Dispute", 
      "Payout", 
      "Transaction", 
      "Membership", 
      "Pool", 
      "BankAccount", 
      "PaymentMethod", 
      "Notification", 
      "WebhookLog", 
      "User" 
    RESTART IDENTITY CASCADE;
  `);
}

export function resetMocks() {
  vi.clearAllMocks();
  // Restore default resolve values
  if (vi.isMockFunction(paystackMocks.initializeTransaction)) {
    (paystackMocks.initializeTransaction as any).mockImplementation(async (_email: any, _amount: any, _callbackUrl: any, reference: any) => {
      const ref = reference || 'ref_' + Math.random().toString(36).substring(7);
      return {
        authorization_url: 'https://checkout.paystack.com/mock',
        access_code: 'mock_access',
        reference: ref,
      };
    });
  }
  if (vi.isMockFunction(paystackMocks.verifyTransaction)) {
    (paystackMocks.verifyTransaction as any).mockImplementation(async (reference: any) => {
      const ref = reference || 'ref_mock';
      return {
        status: 'success',
        reference: ref,
        amount: 500000,
        gateway_response: 'Successful',
        channel: 'card',
        customer: { email: 'test@example.com' },
        authorization: {
          authorization_code: 'AUTH_mock_' + ref,
          card_type: 'visa',
          last4: '4081',
          exp_month: '12',
          exp_year: '2030',
          bank: 'TEST BANK',
          brand: 'visa',
          reusable: true,
        },
      };
    });
  }
  if (vi.isMockFunction(paystackMocks.chargeAuthorization)) {
    (paystackMocks.chargeAuthorization as any).mockImplementation(async (_authCode: any, _email: any, amount: any, reference: any) => {
      const ref = reference || 'ref_' + Math.random().toString(36).substring(7);
      return {
        status: 'success',
        reference: ref,
        amount: (amount || 0) * 100,
        gateway_response: 'Approved',
      };
    });
  }
  if (vi.isMockFunction(paystackMocks.refundTransaction)) {
    (paystackMocks.refundTransaction as any).mockImplementation(async (reference: any) => ({
      status: 'pending',
      transaction: { reference: reference || 'ref_refund_mock' },
    }));
  }
  if (vi.isMockFunction(paystackMocks.initiateTransfer)) {
    (paystackMocks.initiateTransfer as any).mockImplementation(async (amount: any, recipientCode: any, reason: any, reference: any) => {
      const ref = reference || 'ref_trf_' + Math.random().toString(36).substring(7);
      return {
        status: 'pending',
        transfer_code: 'TRF_mock_' + ref,
        reference: ref,
        amount: (amount || 0) * 100,
        recipient: recipientCode,
        reason,
      };
    });
  }
  if (vi.isMockFunction(paystackMocks.verifyTransfer)) {
    (paystackMocks.verifyTransfer as any).mockImplementation(async (reference: any) => ({
      status: 'success',
      reference: reference || 'ref_mock',
    }));
  }
  if (vi.isMockFunction(paystackMocks.createTransferRecipient)) {
    (paystackMocks.createTransferRecipient as any).mockImplementation(async (_name: any, accountNumber: any, _bankCode: any) => ({
      recipient_code: 'RCP_mock_' + (accountNumber || '1234567890'),
    }));
  }
  if (vi.isMockFunction(paystackMocks.resolveBankAccount)) {
    (paystackMocks.resolveBankAccount as any).mockImplementation(async (accountNumber: any, _bankCode: any) => ({
      account_name: 'MOCK ACCOUNT NAME',
      account_number: accountNumber,
    }));
  }

  // Email mocks
  Object.values(emailMocks).forEach((mockFn) => {
    if (vi.isMockFunction(mockFn)) {
      mockFn.mockResolvedValue(undefined);
    }
  });
}

export function signCookie(user: { id: string; role: string; email: string }): string {
  const token = jwt.sign(
    { userId: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET || 'test-jwt-secret-key-at-least-64-chars-long-splitpayng-test-suite-0001',
    { expiresIn: '7d' }
  );
  return `token=${token}`;
}

export function signWebhook(body: unknown): string {
  const payloadStr = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_splitpayng_mock_secret_key')
    .update(payloadStr)
    .digest('hex');
}

export async function createUser(overrides: {
  email?: string;
  fullName?: string;
  password?: string;
  role?: string;
  emailVerified?: boolean;
} = {}) {
  const id = uniqueId();
  const email = overrides.email || `user_${id}@example.com`;
  const passwordHash = overrides.password
    ? bcrypt.hashSync(overrides.password, 4)
    : bcrypt.hashSync('Password123!', 4);

  return await prisma.user.create({
    data: {
      email,
      fullName: overrides.fullName || 'Test User',
      passwordHash,
      role: overrides.role || 'MEMBER',
      emailVerified: overrides.emailVerified !== undefined ? overrides.emailVerified : true,
    },
  });
}

export async function createHostWithPool(overrides: {
  host?: any;
  pool?: any;
  withBankAccount?: boolean;
  bankVerified?: boolean;
  passphrase?: string;
  pricePerSeat?: number;
  totalSeats?: number;
  renewalDay?: number;
  name?: string;
  category?: string;
  poolType?: any;
  status?: any;
} = {}) {
  const host = overrides.host || (await createUser({ role: 'HOST', emailVerified: true }));
  let bankAccount = null;

  if (overrides.withBankAccount !== false) {
    const bankVerified = overrides.bankVerified !== undefined ? overrides.bankVerified : true;
    bankAccount = await prisma.bankAccount.create({
      data: {
        userId: host.id,
        accountNumber: '0123456789',
        bankCode: '058',
        bankName: 'Guaranty Trust Bank',
        accountName: host.fullName,
        recipientCode: 'RCP_mock_0123456789',
        verified: bankVerified,
      },
    });
  }

  const passphrase = overrides.passphrase || 'secret12345';
  const encryptedCreds = encrypt(JSON.stringify({ email: 'sub@example.com', password: 'password123' }), passphrase);

  const poolData = overrides.pool || {};
  const pool = await prisma.pool.create({
    data: {
      hostId: host.id,
      name: overrides.name || poolData.name || `Netflix Shared Pool ${uniqueId()}`,
      category: overrides.category || poolData.category || 'Entertainment',
      poolType: overrides.poolType || poolData.poolType || 'PUBLIC',
      totalSeats: overrides.totalSeats !== undefined ? overrides.totalSeats : (poolData.totalSeats !== undefined ? poolData.totalSeats : 4),
      pricePerSeat: overrides.pricePerSeat !== undefined ? overrides.pricePerSeat : (poolData.pricePerSeat !== undefined ? poolData.pricePerSeat : 2500),
      renewalDay: overrides.renewalDay !== undefined ? overrides.renewalDay : (poolData.renewalDay !== undefined ? poolData.renewalDay : 1),
      encryptedCredentials: encryptedCreds,
      status: overrides.status || poolData.status || 'ACTIVE',
    },
  });

  return { host, pool, passphrase, bankAccount };
}

export async function createMembership(overrides: {
  userId?: string;
  poolId?: string;
  status?: any;
  escrowEndsAt?: Date;
  nextBillingDate?: Date;
  paystackAuthCode?: string;
  billingAttempts?: number;
  billingCycleDate?: Date;
} = {}) {
  let userId = overrides.userId;
  if (!userId) {
    const u = await createUser();
    userId = u.id;
  }
  let poolId = overrides.poolId;
  if (!poolId) {
    const { pool } = await createHostWithPool();
    poolId = pool.id;
  }

  return await prisma.membership.create({
    data: {
      userId,
      poolId,
      status: overrides.status || 'ACTIVE',
      escrowEndsAt: overrides.escrowEndsAt,
      nextBillingDate: overrides.nextBillingDate || new Date(Date.now() + 30 * 86400_000),
      paystackAuthCode: overrides.paystackAuthCode,
      billingAttempts: overrides.billingAttempts !== undefined ? overrides.billingAttempts : 0,
      billingCycleDate: overrides.billingCycleDate,
    },
  });
}

export async function createPendingJoinTransaction(overrides: {
  userId?: string;
  poolId?: string;
  amount?: number;
  reference?: string;
  membershipId?: string;
} = {}) {
  const userId = overrides.userId || (await createUser()).id;
  let poolId = overrides.poolId;
  let amount = overrides.amount !== undefined ? overrides.amount : 2500;
  if (!poolId) {
    const { pool } = await createHostWithPool({ pool: { pricePerSeat: amount } });
    poolId = pool.id;
  } else {
    const p = await prisma.pool.findUnique({ where: { id: poolId } });
    if (p) amount = p.pricePerSeat;
  }

  const platformFee = Math.floor(amount * 0.20);
  const hostPayout = amount - platformFee;
  const reference = overrides.reference || ('ref_join_' + uniqueId());

  return await prisma.transaction.create({
    data: {
      reference,
      userId,
      amount,
      platformFee,
      hostPayout,
      type: 'JOIN',
      status: 'PENDING',
      membershipId: overrides.membershipId,
      paystackData: { poolId, userId },
    },
  });
}

export async function createDueRecurringMembership(overrides: {
  pricePerSeat?: number;
  totalSeats?: number;
  renewalDay?: number;
  withCard?: boolean;
  billingAttempts?: number;
  nextBillingDate?: Date;
} = {}) {
  const host = await createUser({ role: 'HOST', emailVerified: true });
  const { pool, passphrase, bankAccount } = await createHostWithPool({
    host,
    pool: {
      pricePerSeat: overrides.pricePerSeat || 2500,
      totalSeats: overrides.totalSeats !== undefined ? overrides.totalSeats : 4,
      renewalDay: overrides.renewalDay !== undefined ? overrides.renewalDay : 1,
    },
  });
  const user = await createUser({ role: 'MEMBER', emailVerified: true });

  let paymentMethod = null;
  if (overrides.withCard !== false) {
    paymentMethod = await prisma.paymentMethod.create({
      data: {
        userId: user.id,
        authorizationCode: 'AUTH_mock_' + uniqueId(),
        cardType: 'visa',
        last4: '4081',
        expMonth: '12',
        expYear: '2030',
        bank: 'TEST BANK',
        isDefault: true,
      },
    });
  }

  const membership = await prisma.membership.create({
    data: {
      userId: user.id,
      poolId: pool.id,
      status: 'ACTIVE',
      nextBillingDate: overrides.nextBillingDate || new Date(Date.now() - 3600_000), // 1 hour ago (due)
      billingAttempts: overrides.billingAttempts !== undefined ? overrides.billingAttempts : 0,
    },
  });

  return { host, pool, user, membership, paymentMethod, passphrase, bankAccount };
}
