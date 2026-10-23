const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const BASE_URL = 'https://api.paystack.co';

export class PaystackError extends Error {
  status?: number;
  data?: any;

  constructor(message: string, status?: number, data?: any) {
    super(message);
    this.name = 'PaystackError';
    this.status = status;
    this.data = data;
  }
}

export type PaystackErrorClassification =
  | 'DEFINITELY_NOT_CREATED'
  | 'POSSIBLY_CREATED'
  | 'DUPLICATE_REFERENCE'
  | 'PERMANENT';

export function classifyPaystackError(err: any): PaystackErrorClassification {
  if (!err) return 'POSSIBLY_CREATED';
  const status = err.status;
  const msg = (err.message || '').toLowerCase();

  // Duplicate transfer reference on Paystack
  if (
    msg.includes('duplicate') ||
    msg.includes('already been initiated') ||
    msg.includes('reference has already been used')
  ) {
    return 'DUPLICATE_REFERENCE';
  }

  // Definitely not created: Paystack balance shortfall or rate limits
  if (
    msg.includes('balance') ||
    status === 429
  ) {
    return 'DEFINITELY_NOT_CREATED';
  }

  // Possibly created: Server errors, timeouts, or network drops
  if (
    status === 408 ||
    (status >= 500 && status < 600) ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('fetch failed')
  ) {
    return 'POSSIBLY_CREATED';
  }

  // Definite 4xx rejections (e.g. invalid recipient, recipient disabled, etc.)
  if (status && status >= 400 && status < 500) {
    return 'PERMANENT';
  }

  return 'POSSIBLY_CREATED';
}

async function paystackRequest(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new PaystackError(res.statusText || 'Failed to parse Paystack response', res.status);
  }

  if (!res.ok || !data.status) {
    throw new PaystackError(data.message || 'Paystack API error', res.status, data);
  }
  return data;
}

export async function initializeTransaction(
  email: string,
  amount: number,
  callbackUrl: string,
  reference: string,
  metadata: Record<string, any> = {},
  channels?: string[]
) {
  const payload: any = {
    email,
    amount: amount * 100,
    callback_url: callbackUrl,
    reference,
    metadata,
  };
  if (channels && channels.length > 0) {
    payload.channels = channels;
  }
  const data = await paystackRequest('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.data;
}

export async function verifyTransaction(reference: string) {
  const data = await paystackRequest(`/transaction/verify/${reference}`);
  return data.data;
}

export async function createTransferRecipient(name: string, accountNumber: string, bankCode: string) {
  const data = await paystackRequest('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    }),
  });
  return data.data;
}

export async function initiateTransfer(amount: number, recipientCode: string, reason: string, reference: string) {
  const data = await paystackRequest('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: amount * 100,
      recipient: recipientCode,
      reason,
      reference,
    }),
  });
  return data.data;
}

export async function verifyTransfer(reference: string) {
  const data = await paystackRequest(`/transfer/verify/${encodeURIComponent(reference)}`);
  return data.data;
}

export async function resolveBankAccount(accountNumber: string, bankCode: string) {
  const data = await paystackRequest(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  return data.data;
}

export async function refundTransaction(reference: string) {
  const data = await paystackRequest('/refund', {
    method: 'POST',
    body: JSON.stringify({
      transaction: reference,
    }),
  });
  return data.data;
}

export async function chargeAuthorization(
  authorizationCode: string,
  email: string,
  amount: number,
  reference: string,
  metadata?: Record<string, any>
) {
  const payload: any = {
    authorization_code: authorizationCode,
    email,
    amount: amount * 100,
    reference,
  };
  if (metadata) {
    payload.metadata = metadata;
  }
  const data = await paystackRequest('/transaction/charge_authorization', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.data;
}