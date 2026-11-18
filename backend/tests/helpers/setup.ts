import { vi, afterAll } from 'vitest';
import { prisma } from '../../src/db.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-at-least-64-chars-long-splitpayng-test-suite-0001';
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_splitpayng_mock_secret_key';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_mock_key';

// Mock paystack utility
vi.mock('../../src/utils/paystack.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    initializeTransaction: vi.fn().mockImplementation(async (_email, _amount, _callbackUrl, reference) => {
      const ref = reference || 'ref_' + Math.random().toString(36).substring(7);
      return {
        authorization_url: 'https://checkout.paystack.com/mock',
        access_code: 'mock_access',
        reference: ref,
      };
    }),
    verifyTransaction: vi.fn().mockImplementation(async (reference) => {
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
    }),
    chargeAuthorization: vi.fn().mockImplementation(async (_authorizationCode, _email, amount, reference, _metadata) => {
      const ref = reference || 'ref_' + Math.random().toString(36).substring(7);
      return {
        status: 'success',
        reference: ref,
        amount: (amount || 0) * 100,
        gateway_response: 'Approved',
      };
    }),
    refundTransaction: vi.fn().mockImplementation(async (reference) => {
      const ref = reference || 'ref_refund_' + Math.random().toString(36).substring(7);
      return {
        status: 'pending',
        transaction: { reference: ref },
      };
    }),
    initiateTransfer: vi.fn().mockImplementation(async (amount, recipientCode, reason, reference) => {
      const ref = reference || 'ref_trf_' + Math.random().toString(36).substring(7);
      return {
        status: 'pending',
        transfer_code: 'TRF_mock_' + ref,
        reference: ref,
        amount: (amount || 0) * 100,
        recipient: recipientCode,
        reason,
      };
    }),
    verifyTransfer: vi.fn().mockImplementation(async (reference) => {
      const ref = reference || 'ref_mock';
      return {
        status: 'success',
        reference: ref,
      };
    }),
    createTransferRecipient: vi.fn().mockImplementation(async (_name, accountNumber, _bankCode) => {
      return {
        recipient_code: 'RCP_mock_' + (accountNumber || '1234567890'),
      };
    }),
    resolveBankAccount: vi.fn().mockImplementation(async (accountNumber, _bankCode) => {
      return {
        account_name: 'MOCK ACCOUNT NAME',
        account_number: accountNumber,
      };
    }),
  };
});

// Mock email utility
vi.mock('../../src/utils/email.js', () => ({
  sendMagicLinkEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendCredentialsEmail: vi.fn().mockResolvedValue(undefined),
  sendEscrowReminderEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeOpenedEmail: vi.fn().mockResolvedValue(undefined),
  sendDisputeResolvedEmail: vi.fn().mockResolvedValue(undefined),
  sendPayoutConfirmedEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentSuccessEmail: vi.fn().mockResolvedValue(undefined),
  sendPoolFilledEmail: vi.fn().mockResolvedValue(undefined),
  sendNewMemberEmail: vi.fn().mockResolvedValue(undefined),
  sendUpcomingBillingEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendCredentialsRotatedEmail: vi.fn().mockResolvedValue(undefined),
}));

afterAll(async () => {
  await prisma.$disconnect();
});
