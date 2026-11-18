# Failure Evidence — Phase 0 EXPECTED-FAIL tests (groups B–F)

Each test below was run **alone** with `npx vitest run <file> -t "<id>:"` (colour disabled), against
the current working tree (see `docs/open-questions.md` §1). Each one fails on the assertion that
encodes the bug. None fail on setup, fixtures, timeouts or harness errors.

Flakiness check: each B–F file was run 3× as a whole, and C was run 3 more times after its final
edit. Every test gave the same pass/fail result on every run. Group results per run:
B 6/6 pass · C 1 pass + 2 expected-fail · D 3 pass + 1 expected-fail ·
E 8/8 pass · F 6 pass + 1 expected-fail + 1 todo.

---

## C1 — same `charge.success` delivered 10× concurrently

`npx vitest run tests/C-webhook-idempotency.test.ts -t "C1:"`

```
FAIL  tests/C-webhook-idempotency.test.ts > Group C: webhook replay & idempotency > C1: same charge.success webhook delivered 10x concurrently -> 1 membership, 1 payout, each email/notification ONCE
AssertionError: expected { …(8) } to deeply equal { …(8) }
- Expected
+ Received
  Object {
    "httpStatuses": Array [ 200, 200, 200, 200, 200, 200, 200, 200, 200, 200 ],
    "memberships": 1,
-   "newMemberEmail": 1,
-   "newMemberNotif": 1,
-   "paymentSuccessEmail": 1,
-   "paymentSuccessNotif": 1,
+   "newMemberEmail": 10,
+   "newMemberNotif": 10,
+   "paymentSuccessEmail": 10,
+   "paymentSuccessNotif": 10,
    "payouts": 1,
    "txnStatus": "SUCCESS",
  }
 ❯ tests/C-webhook-idempotency.test.ts:112:8
      Tests  1 failed | 2 skipped (3)
```

**Why this is the bug:** every delivery passes the `webhookLog.processed` and
`transaction.status === 'SUCCESS'` checks before any of them commits. The deliveries that read the
existing membership after the first claim committed take the "already ACTIVE/IN_ESCROW" branch,
which returns `success: true`. Each of them then sends the member and host emails and creates the
notifications again, because nothing atomically claims those side effects. The seat lock does keep
memberships and payouts at 1. The output was identical in all 4 runs.

---

## C2 — `GET /verify` and `POST /webhook` concurrently for the same reference

`npx vitest run tests/C-webhook-idempotency.test.ts -t "C2:"`

```
FAIL  tests/C-webhook-idempotency.test.ts > Group C: webhook replay & idempotency > C2: GET /verify and POST /webhook for the same reference concurrently -> 1 membership, emails once, neither errors
AssertionError: expected { httpStatuses: [ 200, 200 ], …(7) } to deeply equal { httpStatuses: [ 200, 200 ], …(7) }
- Expected
+ Received
  Object {
    "errorResponses": 0,
    "httpStatuses": Array [ 200, 200 ],
    "memberships": 1,
-   "newMemberEmail": 1,
-   "newMemberNotif": 1,
-   "paymentSuccessEmail": 1,
-   "paymentSuccessNotif": 1,
+   "newMemberEmail": 2,
+   "newMemberNotif": 2,
+   "paymentSuccessEmail": 2,
+   "paymentSuccessNotif": 2,
    "payouts": 1,
  }
 ❯ tests/C-webhook-idempotency.test.ts:145:8
      Tests  1 failed | 2 skipped (3)
```

When the whole file runs (3 of 3 runs), the same race shows up earlier, in the non-atomic
`webhookLog.upsert` (`payments.ts:425`, outside the try/catch):

```
-   "errorResponses": 0,
+   "errorResponses": 1,
    "httpStatuses": Array [
      200,
-     200,
+     500,
    ],

prisma:error Invalid `prisma.webhookLog.upsert()` invocation in src/routes/payments.ts:425:27
→ 425 await prisma.webhookLog.upsert(
Unique constraint failed on the fields: (`reference`)   code: 'P2002', meta: { modelName: 'WebhookLog', target: [ 'reference' ] }
```

**Why this is the bug:** both requests reach the same unlocked check-then-act in `processPayment`.
The plan predicts "P2002 or duplicate emails/notifications", and both have been observed. Which one
appears depends on whether Postgres interleaves the two emulated upserts (SELECT, then INSERT). The
test failed in every run.

---

## D2 — escrow expiry overwrites a concurrent `DISPUTED`

`npx vitest run tests/D-escrow-expiry.test.ts -t "D2:"`

```
FAIL  tests/D-escrow-expiry.test.ts > Group D: escrow expiry > D2: RACE — membership becomes DISPUTED after findMany, before write -> stays DISPUTED, payout NOT scheduled
AssertionError: expected 'ACTIVE' to be 'DISPUTED' // Object.is equality
Expected: "DISPUTED"
Received: "ACTIVE"
 ❯ tests/D-escrow-expiry.test.ts:72:23
     71|     const m = await prisma.membership.findUnique({ where: { id: member…
     72|     expect(m!.status).toBe('DISPUTED');
      Tests  1 failed | 3 skipped (4)
```

**Why this is the bug:** the dispute is committed right after the job's `findMany` returns, which is
the window named in the plan. The test checks that the injection ran (`expect(injected).toBe(true)`
passes). The job then runs an unconditional
`prisma.membership.update({ where: { id }, data: { status: 'ACTIVE' } })` with no
`status: 'IN_ESCROW'` guard, so it overwrites `DISPUTED`.

---

## F5 — 3 FAILED recurring charges in 90 days should stop billing

`npx vitest run tests/F-recurring-billing.test.ts -t "F5:"`

```
FAIL  tests/F-recurring-billing.test.ts > Group F: recurring billing > F5: 3 FAILED recurring transactions in 90 days -> membership FAILED and not charged again
AssertionError: expected { chargeAttempts: 2, …(1) } to deeply equal { chargeAttempts: 1, …(1) }
- Expected
+ Received
  Object {
-   "chargeAttempts": 1,
+   "chargeAttempts": 2,
    "membershipStatus": "FAILED",
  }
 ❯ tests/F-recurring-billing.test.ts:247:8
      Tests  1 failed | 7 skipped (8)
```

**Why this is the bug:** after the third decline within 90 days, the earlier in-test assertion
`count(FAILED RECURRING, last 90d) === 3` passes. The membership is still ACTIVE, because
`MAX_BILLING_ATTEMPTS = 4`. The next run charges the card a **4th** time, and only then marks the
membership FAILED.
