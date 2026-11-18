# Backend Testing

The backend test suite requires a local PostgreSQL instance with a database whose name ends in `_test` (for example, `splitpayng_test`).

## Safety Guard

`backend/tests/helpers/testDb.ts` enforces that `TEST_DATABASE_URL` points to:
- a localhost address (`localhost`, `127.0.0.1`, `::1`, or `[::1]`), and
- a database name ending with `_test`.

If either check fails, the test runner refuses to start before pushing schema or touching any data.

## Setting `TEST_DATABASE_URL`

Set `TEST_DATABASE_URL` in your terminal session before running tests. In PowerShell, use `Read-Host -AsSecureString` so the password is never saved to disk or shell history:

```powershell
$pw = Read-Host "Postgres password" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)
)
$env:TEST_DATABASE_URL = "postgresql://postgres:${plain}@localhost:5432/splitpayng_test?connection_limit=20"
Remove-Variable pw, plain
cd backend
npm test
```

## Optional Docker Database

Docker is optional. If you prefer a containerized test database, `docker-compose.test.yml` starts Postgres on port `5433` matching the default fallback URL (`postgresql://postgres:postgres@localhost:5433/splitpayng_test?connection_limit=20`):

```powershell
docker compose -f docker-compose.test.yml up -d
```
