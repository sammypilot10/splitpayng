import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, state } = vi.hoisted(() => {
  interface MockPayout {
    id: string;
    transactionId: string;
    status: 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    failureReason?: string | null;
    payoutDueAt?: Date | null;
  }

  interface MockTransaction {
    id: string;
    membershipId: string;
    type: 'JOIN' | 'RECURRING';
    status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
    createdAt: Date;
    payout?: MockPayout;
  }

  const state = {
    transactions: [] as MockTransaction[],
    payouts: [] as MockPayout[],
  };

  const mockPrisma = {
    transaction: {
      findFirst: vi.fn(async ({ where, orderBy, include }: any) => {
        let filtered = state.transactions.filter((t) => {
          if (where.membershipId && t.membershipId !== where.membershipId) return false;
          if (where.status && t.status !== where.status) return false;
          if (where.type && t.type !== where.type) return false;
          return true;
        });

        if (orderBy?.createdAt === 'desc') {
          filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        } else if (orderBy?.createdAt === 'asc') {
          filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        // If no orderBy, it preserves insertion order (oldest first)

        const result = filtered[0];
        if (!result) return null;

        if (include?.payout) {
          const p = state.payouts.find((item) => item.transactionId === result.id);
          return { ...result, payout: p ? { ...p } : null };
        }
        return { ...result };
      }),
    },
    payout: {
      update: vi.fn(async ({ where, data }: any) => {
        const p = state.payouts.find((item) => item.id === where.id);
        if (!p) throw new Error('Payout not found');
        Object.assign(p, data);
        return { ...p };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let matchedCount = 0;
        for (const p of state.payouts) {
          if (where.id && p.id !== where.id) continue;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.status && p.status !== cond.status) return false;
              if (cond.failureReason && p.failureReason !== cond.failureReason) return false;
              return true;
            });
            if (!matchesOr) continue;
          } else {
            if (where.status && p.status !== where.status) continue;
          }
          Object.assign(p, data);
          matchedCount++;
        }
        return { count: matchedCount };
      }),
    },
  };

  return { mockPrisma, state };
});

vi.mock('../src/db.js', () => ({
  prisma: mockPrisma,
}));

import { getCurrentJoinTransaction, schedulePayoutForMembership } from '../src/utils/transactions.js';

describe('Task 01: Wrong transaction chosen & payout scheduling', () => {
  const membershipId = 'membership-123';

  beforeEach(() => {
    vi.clearAllMocks();
    state.transactions = [];
    state.payouts = [];
  });

  it('selects latest JOIN transaction and schedules only the new payout when old payout is COMPLETED', async () => {
    // Transaction 1: Old JOIN, COMPLETED payout
    const oldPayout = {
      id: 'payout-old',
      transactionId: 'tx-old',
      status: 'COMPLETED' as const,
      payoutDueAt: new Date('2026-01-02'),
    };
    const oldTx = {
      id: 'tx-old',
      membershipId,
      type: 'JOIN' as const,
      status: 'SUCCESS' as const,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      payout: oldPayout,
    };

    // Transaction 2: New JOIN after rejoin, PENDING payout
    const newPayout = {
      id: 'payout-new',
      transactionId: 'tx-new',
      status: 'PENDING' as const,
      payoutDueAt: null,
    };
    const newTx = {
      id: 'tx-new',
      membershipId,
      type: 'JOIN' as const,
      status: 'SUCCESS' as const,
      createdAt: new Date('2026-02-01T10:00:00Z'),
      payout: newPayout,
    };

    state.transactions.push(oldTx, newTx);
    state.payouts.push(oldPayout, newPayout);

    const dueAt = new Date('2026-02-03T10:00:00Z');
    await schedulePayoutForMembership(membershipId, dueAt, mockPrisma);

    // Old payout must NOT be touched or scheduled
    expect(oldPayout.status).toBe('COMPLETED');

    // New payout MUST be transitioned to SCHEDULED
    expect(newPayout.status).toBe('SCHEDULED');
    expect(newPayout.payoutDueAt).toEqual(dueAt);
  });

  it('leaves already SCHEDULED or COMPLETED payouts untouched', async () => {
    const scheduledPayout = {
      id: 'payout-sched',
      transactionId: 'tx-sched',
      status: 'SCHEDULED' as const,
      payoutDueAt: new Date('2026-03-01T10:00:00Z'),
    };
    const tx = {
      id: 'tx-sched',
      membershipId,
      type: 'JOIN' as const,
      status: 'SUCCESS' as const,
      createdAt: new Date('2026-03-01T09:00:00Z'),
      payout: scheduledPayout,
    };

    state.transactions.push(tx);
    state.payouts.push(scheduledPayout);

    const originalDueAt = scheduledPayout.payoutDueAt;
    const newDueAt = new Date('2026-03-05T10:00:00Z');

    await schedulePayoutForMembership(membershipId, newDueAt, mockPrisma);

    // Must remain SCHEDULED with original payoutDueAt unchanged
    expect(scheduledPayout.status).toBe('SCHEDULED');
    expect(scheduledPayout.payoutDueAt).toEqual(originalDueAt);
  });

  it('does NOT reschedule a payout FAILED for a refund reason', async () => {
    const refundFailedPayout = {
      id: 'payout-refunded',
      transactionId: 'tx-refunded',
      status: 'FAILED' as const,
      failureReason: 'Dispute resolved — member refunded',
      payoutDueAt: null,
    };
    const tx = {
      id: 'tx-refunded',
      membershipId,
      type: 'JOIN' as const,
      status: 'SUCCESS' as const,
      createdAt: new Date('2026-04-01T09:00:00Z'),
      payout: refundFailedPayout,
    };

    state.transactions.push(tx);
    state.payouts.push(refundFailedPayout);

    const dueAt = new Date('2026-04-02T10:00:00Z');
    await schedulePayoutForMembership(membershipId, dueAt, mockPrisma);

    // Must remain FAILED and not rescheduled
    expect(refundFailedPayout.status).toBe('FAILED');
    expect(refundFailedPayout.payoutDueAt).toBeNull();
  });

  it('reschedules a payout FAILED because host had no verified bank account', async () => {
    const bankFailedPayout = {
      id: 'payout-no-bank',
      transactionId: 'tx-no-bank',
      status: 'FAILED' as const,
      failureReason: 'No verified bank account',
      payoutDueAt: null,
    };
    const tx = {
      id: 'tx-no-bank',
      membershipId,
      type: 'JOIN' as const,
      status: 'SUCCESS' as const,
      createdAt: new Date('2026-04-01T09:00:00Z'),
      payout: bankFailedPayout,
    };

    state.transactions.push(tx);
    state.payouts.push(bankFailedPayout);

    const dueAt = new Date('2026-04-02T10:00:00Z');
    await schedulePayoutForMembership(membershipId, dueAt, mockPrisma);

    // Must be rescheduled to SCHEDULED
    expect(bankFailedPayout.status).toBe('SCHEDULED');
    expect(bankFailedPayout.payoutDueAt).toEqual(dueAt);
  });
});
