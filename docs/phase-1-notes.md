# Phase 1 Fixes Notes

Branch: `phase-1-fixes` — Final suite result: **74 passed | 1 todo (75)** across 13 test files (baseline 63 passing + 7 fixes + 3 stale-claim tests + 1 upload-headers test; F7 remains `todo`).

## C2 & C1 — Concurrent webhook / verify race (`processPayment`)
- **Root cause:** `processPayment` checked `webhookLog.processed` and ran `webhookLog.upsert({ update: {} })` non-atomically, causing concurrent deliveries of the same reference to throw `P2002` (HTTP 500) or execute duplicate emails and notifications.
- **Fix:** Replaced check-then-upsert with an atomic PostgreSQL `ON CONFLICT DO NOTHING` claim (`prisma.webhookLog.createMany({ skipDuplicates: true })`), plus atomic stale-claim recovery (`updateMany` on `processed: false` and `createdAt < now - 2 min`, refreshing `createdAt`), and cleanup of unprocessed claims on early validation failure or unexpected errors. Added `C-webhook-stale-claim.test.ts` covering stale concurrent reclaim, fresh in-flight claim, and completed claim.
- **Files changed:** `backend/src/routes/payments.ts`, `backend/tests/C-webhook-stale-claim.test.ts`
- **Not changed:** No schema changes; existing `C-webhook-idempotency.test.ts` untouched; no separate C1 commit needed because the atomic claim already guarantees side effects run once.

## D2 — Escrow expiry overwrites concurrent `DISPUTED` membership
- **Root cause:** `processExpiredEscrows` ran an unconditional `membership.update({ where: { id }, data: { status: 'ACTIVE' } })` after `findMany`, overwriting memberships disputed in the race window and still scheduling their payout.
- **Fix:** Wrapped per-membership transition in `prisma.$transaction(async (tx) => ...)`, switching to `tx.membership.updateMany({ where: { id: m.id, status: 'IN_ESCROW' }, data: { status: 'ACTIVE' } })` and calling `schedulePayoutForMembership(m.id, payoutDueAt, tx)` only when `updated.count === 1`. Updated D3's assertion (with approval) to observe `tx.payout.updateMany` counts via a `prisma.$transaction` wrapper alongside observable DB/email checks, since Prisma interactive-tx delegates are not visible to spies on `prisma.payout`.
- **Files changed:** `backend/src/job/escrowExpiry.ts`, `backend/tests/D-escrow-expiry.test.ts`
- **Not changed:** `schedulePayoutForMembership` guard in `transactions.ts` kept intact; D1, D2, D4 untouched.

## F5 — Recurring billing retry limit
- **Root cause:** The F5 test asserted an older master rule ("3 FAILED recurring transactions in 90 days") that had been replaced in production by per-cycle dunning (`MAX_BILLING_ATTEMPTS = 4`, retry delays `[1, 3, 5]` days, pool reopening on 4th failure, reset on success).
- **Fix:** Per product decision, kept production dunning unchanged, rewrote F5 (`F5 per-cycle dunning`) to lock in the 4-attempt per-cycle behaviour, and recorded the decision in `docs/open-questions.md`.
- **Files changed:** `backend/tests/F-recurring-billing.test.ts`, `docs/open-questions.md`
- **Not changed:** `backend/src/utils/transactions.ts` and `backend/src/job/escrowExpiry.ts` untouched.

## I1 — Rate limiting behind reverse proxy (`trust proxy`)
- **Root cause:** Express `trust proxy` was unset, so `req.ip` stayed on loopback and `express-rate-limit` could not distinguish clients by `X-Forwarded-For`.
- **Fix:** Added `app.set('trust proxy', trustProxyHops)` before the rate limiters using `TRUST_PROXY` (default `1` hop), and documented it in `backend/.env.example` with placeholder values only.
- **Files changed:** `backend/src/app.ts`, `backend/.env.example`
- **Not changed:** `skipLocalhost` dev helper and rate-limit thresholds left unchanged; `backend/.env` untouched (confirmed git-ignored).

## I2 — Health check does not verify DB connectivity
- **Root cause:** `GET /api/health` returned a static `200 { success: true }` without querying PostgreSQL.
- **Fix:** Made `GET /api/health` run `prisma.$queryRaw\`SELECT 1\`` raced against a configurable `HEALTH_DB_TIMEOUT_MS` timeout (default `5000` ms, cleared in `finally`), returning HTTP `503 { success: false, message: 'Database unavailable' }` on failure without leaking raw DB errors. Documented `HEALTH_DB_TIMEOUT_MS` in `backend/.env.example`.
- **Files changed:** `backend/src/app.ts`, `backend/.env.example`
- **Not changed:** `tests/I-infrastructure.test.ts` untouched.

## H5 — Authenticated users can read other users' uploaded files
- **Root cause:** `GET /api/uploads/:path(*)` checked authentication and path containment, but performed no ownership or dispute-party authorization check, and served files without strict response security headers.
- **Fix:** Audited all uploads (`DisputeEvidence` is the sole upload entity), tightened path containment with `path.relative`, allowed `ADMIN` directly, and required non-admins to match `DisputeEvidence` (`uploadedBy`, `dispute.memberId`, `dispute.membership.userId`, or `dispute.membership.pool.hostId`), returning `403` before `fs.existsSync` on mismatch or unmapped files. Also set explicit response headers on served files: allowlisted `Content-Type` (rejecting unsupported extensions with `403`), `Content-Disposition: inline; filename="<sanitized>"`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, and `Content-Security-Policy: default-src 'none'; sandbox` (without adding `Cross-Origin-Resource-Policy`). Added `H-uploads-headers.test.ts`.
- **Files changed:** `backend/src/routes/uploads.ts`, `backend/tests/H-uploads-headers.test.ts`
- **Not changed:** No schema changes; `upload.ts` image-only allowlist (PNG/JPG/GIF/WEBP) kept without PDF support.

## Not done / later
- **PDF upload support:** Intentionally omitted; uploads remain restricted to PNG, JPG/JPEG, GIF, and WEBP images.
- **E3 & F3 crash-window tests are approximate:** As documented in `docs/open-questions.md` (§§2–3), E3's `prisma.payout.update` fault-injection spy is never reached on current code (because payout claim now happens before `initiateTransfer`), and F3 injects its fault on `prisma.$transaction` rather than individual `tx.*` interactive-transaction delegates.
- **F7 (`test.todo`):** Recurring renewals currently schedule `cycleDate + 30 days` rather than honouring `Pool.renewalDay`.
- **Route shadowing (`GET /api/pools/dashboard-stats`):** Still shadowed by `GET /api/pools/:id` in `backend/src/routes/pools.ts` (noted in `docs/test-plan.md` H1; out of Phase 1 scope).
- **Orphaned disk files on failed evidence upload:** If `POST /api/memberships/:id/dispute/evidence` rejects a request with 403/404 after `multer` writes to disk, the file is not unlinked (non-admins are blocked by default-deny on `/api/uploads`, but disk cleanup is deferred).
- **Duplicate payment by active member (B3):** Paying again for an already `ACTIVE`/`IN_ESCROW` membership updates the membership without auto-refunding the duplicate charge (documented in `docs/test-plan.md` B3).
