const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const BASE_URL = 'https://api.paystack.co';

async function paystackRequest(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || 'Paystack API error');
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