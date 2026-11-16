import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, resetDb, resetMocks, signWebhook } from './helpers/index.js';

describe('Webhook Security', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  it('A1: missing signature -> 401', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .send({ event: 'charge.success', data: { reference: 'test_ref' } });

    expect(res.status).toBe(401);
  });

  it('A2: wrong signature -> 401', async () => {
    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', 'invalid_signature_hex')
      .send({ event: 'charge.success', data: { reference: 'test_ref' } });

    expect(res.status).toBe(401);
  });

  it('A3: valid signature -> 200', async () => {
    const payload = { event: 'charge.success', data: { reference: 'test_ref' } };
    const sig = signWebhook(payload);

    const res = await request(app)
      .post('/api/payments/webhook')
      .set('x-paystack-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});
