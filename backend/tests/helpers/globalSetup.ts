import net from 'net';
import { execSync } from 'child_process';
import path from 'path';
import { PrismaClient } from '@prisma/client';

export async function setup() {
  const backendRoot = path.resolve(__dirname, '../../');
  
  // Probe port 5433
  const is5433Open = await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(5433, '127.0.0.1');
  });

  let testDbUrl: string;

  if (is5433Open) {
    testDbUrl = 'postgresql://postgres:postgres@localhost:5433/splitpayng_test?connection_limit=20';
  } else {
    // Connect to 5432/postgres to create splitpayng_test if not exists
    const adminPrisma = new PrismaClient({
      datasources: {
        db: {
          url: 'postgresql://postgres:postgres@localhost:5432/postgres',
        },
      },
    });

    try {
      const existing = await adminPrisma.$queryRawUnsafe<any[]>(
        `SELECT 1 FROM pg_database WHERE datname = 'splitpayng_test'`
      );
      if (!existing || existing.length === 0) {
        await adminPrisma.$executeRawUnsafe(`CREATE DATABASE "splitpayng_test"`);
      }
    } finally {
      await adminPrisma.$disconnect();
    }

    testDbUrl = 'postgresql://postgres:postgres@localhost:5432/splitpayng_test?connection_limit=20';
  }

  process.env.DATABASE_URL = testDbUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-at-least-64-chars-long-splitpayng-test-suite-0001';
  process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_splitpayng_mock_secret_key';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_mock_key';

  // Run prisma db push
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
