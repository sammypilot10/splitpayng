import { execSync } from 'child_process';
import path from 'path';
import { getTestDatabaseUrl } from './testDb.js';

export async function setup() {
  const backendRoot = path.resolve(__dirname, '../../');
  const testDbUrl = getTestDatabaseUrl();
  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'test';

  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: 'pipe',
    });
  } catch (err: any) {
    console.error('Prisma db push failed:', err.stdout?.toString(), err.stderr?.toString());
    throw err;
  }
}
