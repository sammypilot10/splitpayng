export function getTestDatabaseUrl(): string {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5433/splitpayng_test?connection_limit=20';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL');
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const hostOk = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);

  if (!hostOk || !dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests: the database must be on localhost and its name must end with "_test" (got host="${parsed.hostname}", db="${dbName}")`
    );
  }
  return url;
}
