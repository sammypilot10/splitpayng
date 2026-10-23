import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const { mockPrisma, mockPaystack, state } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret';
  interface MockPayout {
    id: string;
    hostId: string;
    transactionId: string;
    amount: number;
    status: 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    failureReason?: string | null;
    payoutDueAt?: Date | null;
    transferCode?: string | null;
    attempts: number;
    firstAttemptAt?: Date | null;
    lastShortfallAlertAt?: Date | null;
    updatedAt: Date;
    transaction: {
      membershipId: string | null;
    };
    host: {
      email: string;
      fullName: string;
      bankAccount: {
        verified: boolean;
        recipientCode: string;
      } | null;
    };
  }

  const state = {
    payouts: [] as MockPayout[],
    notifications: [] as any[],
    emailsSent: [] as any[],
    initiatedTransfers: [] as any[],
  };

  const mockPaystack = {
    initiateTransfer: vi.fn(async (amount: number, recipientCode: string, reason: string, reference: string) => {
      state.initiatedTransfers.push({ amount, recipientCode, reason, reference });
      return { status: 'success', reference };
    }),
    verifyTransfer: vi.fn(async (reference: string) => {
      return { status: 'success', reference };
    }),
    refundTransaction: vi.fn(async (ref: string) => ({ status: true })),
  };

  const mockPrisma = {
    payout: {
      findMany: vi.fn(async ({ where }: any) => {
        return state.payouts.filter((p) => {
          if (where.status && p.status !== where.status) return false;
          if (where.transferCode?.not === null && !p.transferCode) return false;
          if (where.payoutDueAt?.lte && p.payoutDueAt && p.payoutDueAt > where.payoutDueAt.lte) return false;
          if (where.updatedAt?.lte && p.updatedAt > where.updatedAt.lte) return false;
          return true;
        });
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return state.payouts.find((p) => p.id === where.id) || null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return state.payouts.find((p) => {
          if (where.transferCode && p.transferCode === where.transferCode) return true;
          return false;
        }) || null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const p = state.payouts.find((item) => item.id === where.id);
        if (!p) throw new Error('Payout not found');
        Object.assign(p, data, { updatedAt: new Date() });
        return { ...p };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let matchedCount = 0;
        for (const p of state.payouts) {
          if (where.id && p.id !== where.id) continue;
          if (where.status) {
            if (typeof where.status === 'string' && p.status !== where.status) continue;
            if (where.status.in && !where.status.in.includes(p.status)) continue;
          }
          if (where.transferCode !== undefined) {
            if (where.transferCode?.not === null && !p.transferCode) continue;
            if (typeof where.transferCode === 'string' && p.transferCode !== where.transferCode) continue;
          }

          if (data.attempts?.increment) {
            p.attempts = (p.attempts || 0) + data.attempts.increment;
          } else if (typeof data.attempts === 'number') {
            p.attempts = data.attempts;
          }

          const { attempts, ...restData } = data;
          Object.assign(p, restData, { updatedAt: new Date() });
          matchedCount++;
        }
        return { count: matchedCount };
      }),
    },
    membership: {
      findUnique: vi.fn(async ({ where }: any) => {
        return {
          id: where.id,
          status: 'ACTIVE',
          pool: { id: 'pool-1', name: 'Netflix Premium Family' },
        };
      }),
      count: vi.fn(async () => 1),
    },
    pool: {
      groupBy: vi.fn(async () => []),
    },
    dispute: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const item = { id: 'notif-' + (state.notifications.length + 1), createdAt: new Date(), ...data };
        state.notifications.push(item);
        return item;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return state.notifications.find((n) => {
          if (where.type && n.type !== where.type) return false;
          if (where.createdAt?.gte && n.createdAt < where.createdAt.gte) return false;
          return true;
        }) || null;
      }),
    },
    user: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.role === 'ADMIN') {
          return [{ id: 'admin-1', email: 'admin@splitpay.ng', fullName: 'Admin' }];
        }
        return [];
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id === 'admin-1') {
          return { id: 'admin-1', role: 'ADMIN', email: 'admin@splitpay.ng', fullName: 'Admin' };
        }
        return null;
      }),
    },
  };

  return { mockPrisma, mockPaystack, state };
});

vi.mock('../src/db.js', () => ({
  prisma: mockPrisma,
}));

vi.mock('../src/utils/paystack.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    initiateTransfer: mockPaystack.initiateTransfer,
    verifyTransfer: mockPaystack.verifyTransfer,
    refundTransaction: mockPaystack.refundTransaction,
  };
});

vi.mock('../src/utils/email.js', () => ({
  sendEscrowReminderEmail: vi.fn(),
  sendPayoutConfirmedEmail: vi.fn(async (email, name, poolName, amount) => {
    state.emailsSent.push({ email, name, poolName, amount });
  }),
  sendUpcomingBillingEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  sendDisputeResolvedEmail: vi.fn(),
}));

vi.mock('../src/utils/notifications.js', () => ({
  createNotification: vi.fn(async (notif) => {
    const item = { id: 'notif-' + (state.notifications.length + 1), createdAt: new Date(), ...notif };
    state.notifications.push(item);
    return item;
  }),
}));

import {
  processScheduledPayouts,
  reconcilePendingTransfers,
  loggedOtpPayoutIds,
} from '../src/job/escrowExpiry.js';
import { classifyPaystackError } from '../src/utils/paystack.js';
import { completePayout } from '../src/utils/transactions.js';
import adminRouter from '../src/routes/admin.js';

describe('Task 02: Idempotent payout transfers & reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.payouts = [];
    state.notifications = [];
    state.emailsSent = [];
    state.initiatedTransfers = [];
    loggedOtpPayoutIds?.clear?.();
  });

  // ─── 1. ERROR CLASSIFICATION ─────────────────────────────────────────────
  describe('classifyPaystackError', () => {
    it('classifies real Paystack balance shortfall (HTTP 400) and any error matching "balance" as DEFINITELY_NOT_CREATED', () => {
      // Documented Paystack balance shortfall message
      const errExact = Object.assign(
        new Error('Your balance is not enough to fulfil this request'),
        { status: 400 }
      );
      expect(classifyPaystackError(errExact)).toBe('DEFINITELY_NOT_CREATED');

      // Tolerant variations
      expect(classifyPaystackError(new Error('Insufficient balance in integration'))).toBe('DEFINITELY_NOT_CREATED');
      expect(classifyPaystackError(new Error('Your balance is low'))).toBe('DEFINITELY_NOT_CREATED');
    });

    it('classifies rate limits (HTTP 429) as DEFINITELY_NOT_CREATED', () => {
      const error = Object.assign(new Error('Too many requests'), { status: 429 });
      expect(classifyPaystackError(error)).toBe('DEFINITELY_NOT_CREATED');
    });

    it('classifies duplicate reference as DUPLICATE_REFERENCE', () => {
      const err1 = Object.assign(new Error('A transfer with this reference has already been initiated'), { status: 400 });
      const err2 = Object.assign(new Error('Duplicate Reference'), { status: 400 });
      const err3 = Object.assign(new Error('Reference has already been used'), { status: 400 });

      expect(classifyPaystackError(err1)).toBe('DUPLICATE_REFERENCE');
      expect(classifyPaystackError(err2)).toBe('DUPLICATE_REFERENCE');
      expect(classifyPaystackError(err3)).toBe('DUPLICATE_REFERENCE');
    });

    it('classifies 5xx, 408, timeouts, and network failures as POSSIBLY_CREATED', () => {
      expect(classifyPaystackError(Object.assign(new Error('Internal Server Error'), { status: 500 }))).toBe('POSSIBLY_CREATED');
      expect(classifyPaystackError(Object.assign(new Error('Bad Gateway'), { status: 502 }))).toBe('POSSIBLY_CREATED');
      expect(classifyPaystackError(Object.assign(new Error('Request Timeout'), { status: 408 }))).toBe('POSSIBLY_CREATED');
      expect(classifyPaystackError(new Error('fetch failed: connect ETIMEDOUT'))).toBe('POSSIBLY_CREATED');
      expect(classifyPaystackError(new Error('read ECONNRESET'))).toBe('POSSIBLY_CREATED');
    });

    it('classifies permanent 4xx errors as PERMANENT', () => {
      expect(classifyPaystackError(Object.assign(new Error('Recipient account is disabled or invalid'), { status: 400 }))).toBe('PERMANENT');
      expect(classifyPaystackError(Object.assign(new Error('Invalid Nuban Account'), { status: 400 }))).toBe('PERMANENT');
    });
  });

  // ─── 2. CLAIM-THEN-ACT CONCURRENCY ───────────────────────────────────────
  describe('Concurrency & Claim-Then-Act', () => {
    it('runs concurrently without duplicate transfers', async () => {
      const payout: any = {
        id: 'payout-concurrent',
        hostId: 'host-1',
        transactionId: 'tx-1',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      await Promise.all([
        processScheduledPayouts(),
        processScheduledPayouts(),
      ]);

      expect(state.initiatedTransfers).toHaveLength(1);
      expect(payout.status).toBe('PROCESSING');
    });
  });

  // ─── 3. GLOBAL SHORTFALL ALERT & LOOP STOP ────────────────────────────────
  describe('Definitely-not-created errors & global shortfall alert throttle', () => {
    it('releases claim back to SCHEDULED on shortfall, throttles alert globally (24h), and stops loop', async () => {
      const payout1: any = {
        id: 'payout-shortfall-1',
        hostId: 'host-1',
        transactionId: 'tx-s1',
        amount: 7500,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        firstAttemptAt: null,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };

      const payout2: any = {
        id: 'payout-shortfall-2',
        hostId: 'host-2',
        transactionId: 'tx-s2',
        amount: 8000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        firstAttemptAt: null,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-2' },
        host: {
          email: 'host2@test.com',
          fullName: 'Host Two',
          bankAccount: { verified: true, recipientCode: 'RCP_456' },
        },
      };

      state.payouts.push(payout1, payout2);

      // Payout 1 fails with Paystack balance shortfall
      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Your balance is not enough to fulfil this request'), { status: 400 })
      );

      await processScheduledPayouts();

      // Payout 1 should be released to SCHEDULED with backoff
      expect(payout1.status).toBe('SCHEDULED');
      expect(payout1.attempts).toBe(1);
      expect(payout1.payoutDueAt).toBeDefined();

      // Exactly ONE admin notification created
      const shortfallNotifs = state.notifications.filter((n) => n.type === 'ADMIN_BALANCE_SHORTFALL');
      expect(shortfallNotifs).toHaveLength(1);
      expect(shortfallNotifs[0].userId).toBe('admin-1');

      // The loop must have STOPPED after the first shortfall error: payout2 must still be SCHEDULED with attempts=0
      expect(payout2.status).toBe('SCHEDULED');
      expect(payout2.attempts).toBe(0);
      expect(mockPaystack.initiateTransfer).toHaveBeenCalledTimes(1); // Only payout1 was attempted

      // Subsequent cron run within 24h: must NOT create another ADMIN_BALANCE_SHORTFALL notification
      payout1.payoutDueAt = new Date(Date.now() - 1000);
      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Your balance is not enough to fulfil this request'), { status: 400 })
      );

      await processScheduledPayouts();

      expect(payout1.attempts).toBe(2);
      const shortfallNotifsAfter = state.notifications.filter((n) => n.type === 'ADMIN_BALANCE_SHORTFALL');
      expect(shortfallNotifsAfter).toHaveLength(1); // Still exactly 1 due to global 24h throttle
    });

    it('releases claim back to SCHEDULED on 429 rate limit', async () => {
      const payout: any = {
        id: 'payout-429',
        hostId: 'host-1',
        transactionId: 'tx-429',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Too many requests'), { status: 429 })
      );

      await processScheduledPayouts();

      expect(payout.status).toBe('SCHEDULED');
      expect(payout.attempts).toBe(1);
    });
  });

  // ─── 4. TIME-BASED WINDOW & 4-DAY EXPIRATION ─────────────────────────────
  describe('Time-based retry window & 4-day expiry', () => {
    it('backs off up to ~6h and fails only after ~4 days of retries with admin notification', async () => {
      const fourDaysAgo = new Date(Date.now() - (4 * 24 * 60 * 60 * 1000 + 1000));
      const payout: any = {
        id: 'payout-expired-4days',
        hostId: 'host-1',
        transactionId: 'tx-4days',
        amount: 15000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 15,
        firstAttemptAt: fourDaysAgo,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Your balance is not enough to fulfil this request'), { status: 400 })
      );

      await processScheduledPayouts();

      // Must fail and null transferCode
      expect(payout.status).toBe('FAILED');
      expect(payout.transferCode).toBeNull();
      expect(payout.failureReason).toContain('4 days');

      // Admin notified of final failure
      const finalNotif = state.notifications.find((n) => n.type === 'ADMIN_PAYOUT_FAILED');
      expect(finalNotif).toBeDefined();
      expect(finalNotif.userId).toBe('admin-1');
    });
  });

  // ─── 5. POSSIBLY-CREATED ERRORS (5xx, 408, TIMEOUT, NETWORK) ───────────────
  describe('Possibly-created errors', () => {
    it('leaves payout in PROCESSING for reconcile on 5xx server errors', async () => {
      const payout: any = {
        id: 'payout-500',
        hostId: 'host-1',
        transactionId: 'tx-500',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Internal server error from Paystack'), { status: 500 })
      );

      await processScheduledPayouts();

      expect(payout.status).toBe('PROCESSING');
      expect(payout.transferCode).toBeDefined();
      expect(payout.failureReason).toBeFalsy();
    });

    it('leaves payout in PROCESSING for reconcile on network/timeout errors', async () => {
      const payout: any = {
        id: 'payout-timeout',
        hostId: 'host-1',
        transactionId: 'tx-timeout',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        new Error('fetch failed: connect ETIMEDOUT')
      );

      await processScheduledPayouts();

      expect(payout.status).toBe('PROCESSING');
      expect(payout.transferCode).toBeDefined();
    });
  });

  // ─── 6. DUPLICATE REFERENCE TRIGGERS VERIFY, NEVER DIRECT FAILED ─────────
  describe('Duplicate reference handling', () => {
    it('triggers verifyTransfer immediately and completes payout if transfer succeeded on Paystack', async () => {
      const payout: any = {
        id: 'payout-dup-success',
        hostId: 'host-1',
        transactionId: 'tx-dup-1',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: 'TRF-EXISTING-1',
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('A transfer with this reference has already been initiated'), { status: 400 })
      );

      mockPaystack.verifyTransfer.mockResolvedValueOnce({
        status: 'success',
        reference: 'TRF-EXISTING-1',
      });

      await processScheduledPayouts();

      expect(mockPaystack.verifyTransfer).toHaveBeenCalledWith('TRF-EXISTING-1');
      expect(payout.status).toBe('COMPLETED');
      expect(state.emailsSent).toHaveLength(1);
    });

    it('stays PROCESSING if duplicate reference transfer is still pending or verify fails', async () => {
      const payout: any = {
        id: 'payout-dup-pending',
        hostId: 'host-1',
        transactionId: 'tx-dup-2',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: 'TRF-EXISTING-2',
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.initiateTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Duplicate Reference'), { status: 400 })
      );

      mockPaystack.verifyTransfer.mockResolvedValueOnce({
        status: 'pending',
        reference: 'TRF-EXISTING-2',
      });

      await processScheduledPayouts();

      expect(payout.status).toBe('PROCESSING');
    });
  });

  // ─── 7. RECONCILIATION & OTP DEDUPLICATION ────────────────────────────────
  describe('Reconciliation & OTP logging', () => {
    it('reconciles 404 transfer by returning payout to SCHEDULED with same reference', async () => {
      const payout: any = {
        id: 'payout-rec-404',
        hostId: 'host-1',
        transactionId: 'tx-rec-404',
        amount: 5000,
        status: 'PROCESSING',
        transferCode: 'TRF-404-REF',
        attempts: 1,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.verifyTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Transfer not found'), { status: 404 })
      );

      await reconcilePendingTransfers();

      expect(payout.status).toBe('SCHEDULED');
      expect(payout.transferCode).toBe('TRF-404-REF');
    });

    it('logs OTP warning only ONCE per payout across multiple reconcile runs', async () => {
      const payout: any = {
        id: 'payout-otp-dedup',
        hostId: 'host-1',
        transactionId: 'tx-otp',
        amount: 5000,
        status: 'PROCESSING',
        transferCode: 'TRF-OTP-DEDUP',
        attempts: 1,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.verifyTransfer.mockResolvedValue({
        status: 'otp',
        reference: 'TRF-OTP-DEDUP',
      });

      const consoleErrorSpy = vi.spyOn(console, 'error');

      // First run: should log
      await reconcilePendingTransfers();
      expect(payout.status).toBe('PROCESSING');
      const errorCallsFirstRun = consoleErrorSpy.mock.calls.filter((c) =>
        c[0]?.includes('CRITICAL: Paystack transfer requires OTP')
      ).length;
      expect(errorCallsFirstRun).toBe(1);

      // Second run: should NOT log again
      await reconcilePendingTransfers();
      const errorCallsSecondRun = consoleErrorSpy.mock.calls.filter((c) =>
        c[0]?.includes('CRITICAL: Paystack transfer requires OTP')
      ).length;
      expect(errorCallsSecondRun).toBe(1);
    });

    it('nulls transferCode and marks FAILED when transfer is failed or reversed on Paystack', async () => {
      const payout: any = {
        id: 'payout-rec-failed',
        hostId: 'host-1',
        transactionId: 'tx-rec-failed',
        amount: 5000,
        status: 'PROCESSING',
        transferCode: 'TRF-FAILED-REF',
        attempts: 1,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.verifyTransfer.mockResolvedValueOnce({
        status: 'reversed',
        reason: 'Account closed by bank',
      });

      await reconcilePendingTransfers();

      expect(payout.status).toBe('FAILED');
      expect(payout.transferCode).toBeNull();
      expect(payout.failureReason).toContain('Account closed');
    });
  });

  // ─── 8. NO-BANK-ACCOUNT BRANCH NOTIFICATION GUARD (COUNT === 1) ───────────
  describe('No bank account branch notification guard', () => {
    it('notifies host only when count === 1 on no-bank-account failure', async () => {
      const payout: any = {
        id: 'payout-no-bank',
        hostId: 'host-nobank',
        transactionId: 'tx-nobank',
        amount: 5000,
        status: 'SCHEDULED',
        payoutDueAt: new Date(Date.now() - 1000),
        transferCode: null,
        attempts: 0,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'nobank@test.com',
          fullName: 'No Bank User',
          bankAccount: null, // No bank account
        },
      };
      state.payouts.push(payout);

      // Run two concurrent invocations
      await Promise.all([
        processScheduledPayouts(),
        processScheduledPayouts(),
      ]);

      expect(payout.status).toBe('FAILED');
      expect(payout.failureReason).toBe('No verified bank account');
      // Host notification should be sent exactly ONCE
      const notifs = state.notifications.filter((n) => n.userId === 'host-nobank');
      expect(notifs).toHaveLength(1);
    });
  });

  // ─── 9. SHARED completePayout() HELPER ────────────────────────────────────
  describe('Shared completePayout() helper', () => {
    it('completes payout from PROCESSING, SCHEDULED, and FAILED status', async () => {
      const statuses: Array<'PROCESSING' | 'SCHEDULED' | 'FAILED'> = ['PROCESSING', 'SCHEDULED', 'FAILED'];

      for (const initialStatus of statuses) {
        const payout: any = {
          id: `payout-from-${initialStatus}`,
          hostId: 'host-1',
          transactionId: `tx-${initialStatus}`,
          amount: 6000,
          status: initialStatus,
          transferCode: `TRF-${initialStatus}`,
          attempts: 1,
          updatedAt: new Date(),
          transaction: { membershipId: 'mem-1' },
          host: {
            email: 'host@test.com',
            fullName: 'Host User',
            bankAccount: { verified: true, recipientCode: 'RCP_123' },
          },
        };
        state.payouts.push(payout);

        const res = await completePayout(payout.id, mockPrisma);
        expect(res.completed).toBe(true);
        expect(payout.status).toBe('COMPLETED');
      }
    });

    it('does not send duplicate emails or notifications on concurrent completePayout calls', async () => {
      const payout: any = {
        id: 'payout-shared-comp',
        hostId: 'host-1',
        transactionId: 'tx-comp',
        amount: 5000,
        status: 'PROCESSING',
        transferCode: 'TRF-COMP',
        attempts: 1,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      await Promise.all([
        completePayout(payout.id, mockPrisma),
        completePayout(payout.id, mockPrisma),
      ]);

      expect(payout.status).toBe('COMPLETED');
      expect(state.emailsSent).toHaveLength(1);
      expect(state.notifications.filter((n) => n.type === 'PAYOUT_CONFIRMED')).toHaveLength(1);
    });
  });

  // ─── 10. POST /api/admin/payouts/:id/requeue ─────────────────────────────
  describe('POST /api/admin/payouts/:id/requeue', () => {
    const adminToken = jwt.sign(
      { userId: 'admin-1', email: 'admin@splitpay.ng', role: 'ADMIN' },
      process.env.JWT_SECRET || 'test-secret'
    );
    const memberToken = jwt.sign(
      { userId: 'user-1', email: 'user@test.com', role: 'MEMBER' },
      process.env.JWT_SECRET || 'test-secret'
    );

    function createTestApp() {
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
      const app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use('/api/admin', adminRouter);
      return app;
    }

    it('rejects non-admin users with 403', async () => {
      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/00000000-0000-0000-0000-000000000001/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${memberToken}` },
      });

      server.close();
      expect(res.status).toBe(403);
    });

    it('successfully requeues a FAILED payout, resetting attempts and firstAttemptAt', async () => {
      const validUuid = '11111111-1111-1111-1111-111111111111';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-1',
        amount: 8000,
        status: 'FAILED',
        failureReason: 'Paystack transfer window expired after 4 days of retries',
        transferCode: 'TRF-OLD-1',
        attempts: 12,
        firstAttemptAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      // Verify transfer returns failed on Paystack
      mockPaystack.verifyTransfer.mockResolvedValueOnce({
        status: 'failed',
        reason: 'Bank rejected',
      });

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      const data = await res.json();

      server.close();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Status reset to SCHEDULED, attempts=0, firstAttemptAt=null, failureReason=null, transferCode=null
      expect(payout.status).toBe('SCHEDULED');
      expect(payout.attempts).toBe(0);
      expect(payout.firstAttemptAt).toBeNull();
      expect(payout.failureReason).toBeNull();
      expect(payout.transferCode).toBeNull();
    });

    it('prevents requeue if transfer actually succeeded on Paystack and marks COMPLETED instead with 409', async () => {
      const validUuid = '22222222-2222-2222-2222-222222222222';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-2',
        amount: 8000,
        status: 'FAILED',
        transferCode: 'TRF-ACTUALLY-SUCCEEDED',
        attempts: 5,
        firstAttemptAt: new Date(),
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      // Verify transfer says Paystack already succeeded!
      mockPaystack.verifyTransfer.mockResolvedValueOnce({
        status: 'success',
        reference: 'TRF-ACTUALLY-SUCCEEDED',
      });

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      const data = await res.json();

      server.close();

      expect(res.status).toBe(409);
      expect(data.message).toContain('already succeeded');
      expect(payout.status).toBe('COMPLETED');
    });

    it('returns 502 and leaves payout untouched if verifyTransfer encounters non-404 error', async () => {
      const validUuid = '33333333-3333-3333-3333-333333333333';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-3',
        amount: 8000,
        status: 'FAILED',
        transferCode: 'TRF-PAYSTACK-500',
        attempts: 5,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.verifyTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Paystack server error'), { status: 500 })
      );

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      server.close();

      expect(res.status).toBe(502);
      expect(payout.status).toBe('FAILED');
      expect(payout.transferCode).toBe('TRF-PAYSTACK-500');
    });

    it('refuses to requeue if transaction status is REFUNDED', async () => {
      const validUuid = '44444444-4444-4444-4444-444444444444';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-4',
        amount: 8000,
        status: 'FAILED',
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1', status: 'REFUNDED' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      const data = await res.json();
      server.close();

      expect(res.status).toBe(400);
      expect(data.message).toContain('refunded or disputed');
      expect(payout.status).toBe('FAILED');
    });

    it('refuses to requeue if failureReason indicates dispute refund', async () => {
      const validUuid = '55555555-5555-5555-5555-555555555555';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-5',
        amount: 8000,
        status: 'FAILED',
        failureReason: 'Refunded to member following dispute resolution',
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1', status: 'FAILED' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      const data = await res.json();
      server.close();

      expect(res.status).toBe(400);
      expect(data.message).toContain('refunded or disputed');
      expect(payout.status).toBe('FAILED');
    });

    it('requeues successfully when verifyTransfer returns 404 (transfer never created)', async () => {
      const validUuid = '66666666-6666-6666-6666-666666666666';
      const payout: any = {
        id: validUuid,
        hostId: 'host-1',
        transactionId: 'tx-req-6',
        amount: 8000,
        status: 'FAILED',
        transferCode: 'TRF-NOT-ON-PAYSTACK',
        attempts: 2,
        updatedAt: new Date(),
        transaction: { membershipId: 'mem-1' },
        host: {
          email: 'host@test.com',
          fullName: 'Host User',
          bankAccount: { verified: true, recipientCode: 'RCP_123' },
        },
      };
      state.payouts.push(payout);

      mockPaystack.verifyTransfer.mockRejectedValueOnce(
        Object.assign(new Error('Transfer reference not found'), { status: 404 })
      );

      const app = createTestApp();
      const server = app.listen(0);
      const port = (server.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/admin/payouts/${validUuid}/requeue`, {
        method: 'POST',
        headers: { Cookie: `token=${adminToken}` },
      });
      const data = await res.json();
      server.close();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(payout.status).toBe('SCHEDULED');
      expect(payout.attempts).toBe(0);
      expect(payout.transferCode).toBeNull();
    });
  });
});
