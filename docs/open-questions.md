# Open Questions — Phase 0 (groups B–F)

No test in groups B–F required a production change, so no test was skipped or blocked.
The items below are things a reviewer should know: test-design decisions forced by today's
code, and bugs found that are **not** listed in `docs/test-plan.md`.

## 1. Tests run against the uncommitted working tree in `backend/src/`

The plan's expectations for E2/E3 (`fix/02`) and F2/F3/F4 (`fix/03`) assume the **working tree**.
When this phase started, `git status` already showed uncommitted production changes that this
session did **not** write:

```
 M backend/prisma/schema.prisma
 M backend/src/job/escrowExpiry.ts
 M backend/src/job/scheduler.ts
 M backend/src/routes/payments.ts
 M backend/src/utils/transactions.ts
 D backend/tests/idempotent-transfers.test.ts
 D backend/tests/wrong-transaction.test.ts
?? backend/prisma/migrations/20261023172500_add_membership_billing_fields/
```

The commit `phase 0: concurrency + money tests` contains **only** test files and docs. These
changes are still uncommitted. At `HEAD` alone, group F imports symbols that only exist in the
working tree (`failNoPaymentMethod`, `buildRecurringReference`, `MAX_BILLING_ATTEMPTS` and the
`billingCycleDate` column), so the suite will not run correctly until that work is committed or
dropped. **Decision needed:** who owns these changes, and on which branch should they land?

## 2. E3 injection point is never reached on the working tree

The plan says to inject the failure at "`initiateTransfer` succeeds, then `prisma.payout.update`
throws". In the working tree, `processScheduledPayouts` claims the payout (`updateMany` to
`PROCESSING` + `transferCode`) **before** it calls Paystack. On success it does **no** payout write
afterwards. The test spies on `prisma.payout.update` **and** `prisma.payout.updateMany` and throws on
any payout write after the Paystack mock has resolved. On today's code that spy never fires. The
invariant is still enforced: after a restart, either there is no second `initiateTransfer` or every
call reuses the same reference. On `master` (which writes after the transfer), the same spy would fire. Not verified in this
session: the test was not run against `master`.

## 3. F3 injection is on `prisma.$transaction`, not a model call

After `chargeAuthorization` succeeds, the first DB write is `completeRecurringCharge`, which runs
inside `prisma.$transaction(async (tx) => …)`. Interactive-transaction delegates (`tx.transaction.*`)
are separate proxy objects and cannot be spied from outside. This was checked: a spy on
`prisma.transaction.updateMany` sees 0 calls made through `tx`. So the fault is injected on
`prisma.$transaction`, which is the specific Prisma call that performs the write.

## 4. Spying on Prisma delegates: `vi.restoreAllMocks()` breaks the client

Prisma 5 delegates are composite Proxies. Vitest's `mockRestore()` restores a spy by **deleting** the
own property. The Prisma proxy records that delete, so the method becomes `undefined` for the rest
of the file (`prisma.membership.findUnique is not a function`). `tests/helpers/concurrency.ts` adds
`spyOnPrisma` (still `vi.spyOn`) and `restorePrismaSpies()`, which calls `mockRestore()` and then
re-assigns the original. Every B–F file calls `restorePrismaSpies()` in `afterEach`. **Do not call
`vi.restoreAllMocks()` in these files.**

## 5. Bug found outside the plan: `webhookLog.upsert` raises P2002 under concurrency (C2)

`processPayment` calls `prisma.webhookLog.upsert({ where: { reference }, update: {}, create: … })`
**outside** its try/catch. Because `update` is empty, Prisma cannot use a native
`INSERT … ON CONFLICT` and falls back to SELECT-then-INSERT. Two concurrent deliveries of the same
reference can therefore throw `P2002 Unique constraint failed on (reference)`, and the route returns
**500**. C2 showed this in every whole-file run, and the response that got the 500 varied between
verify and webhook. When C2 ran alone, the race instead showed up as duplicate emails. Both forms
fail the test. Paystack will retry a 500, so the impact is noisy errors and retries rather than lost money,
but it violates "neither errors".

## 6. C1/C2 use a forced (but real) interleaving

Firing 10 identical requests with no coordination gives a different number of duplicates each run
(6 in one early run). To make the outcome deterministic **without sleeps**, C1/C2 instrument the
two non-atomic reads in `processPayment`:

1. a barrier on the `transaction.findUnique` read, so every request has passed the
   `processed` / `status === 'SUCCESS'` checks;
2. a "first-through" gate on the existing-membership read, which holds later requests until the
   first request's seat-claim `$transaction` settles.

Concurrent HTTP requests can reach this interleaving in production; the gates only make it
repeatable. Every gate is also released when any request finishes, so a fixed implementation that
skips these reads cannot deadlock.

## 7. F5 rule ambiguity

The plan says "3 FAILED recurring transactions in 90 days". The code uses a per-cycle counter
(`MAX_BILLING_ATTEMPTS = 4`, reset on success). The test drives the real job: two prior declines
plus a third decline in the run, then time passes and the job runs again. The test does not care
whether a fix checks the rule when a failure is recorded or when billing runs. **Product decision
needed:** should a success in between reset the 90-day window?
