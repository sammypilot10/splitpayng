import { getTestDatabaseUrl } from './testDb.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = getTestDatabaseUrl();
