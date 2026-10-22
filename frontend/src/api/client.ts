const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request<T>(method: string, endpoint: string, body?: any): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

export const api = {
  get: <T = any>(endpoint: string) => request<T>('GET', endpoint),
  post: <T = any>(endpoint: string, body?: any) => request<T>('POST', endpoint, body),
  patch: <T = any>(endpoint: string, body?: any) => request<T>('PATCH', endpoint, body),
  put: <T = any>(endpoint: string, body?: any) => request<T>('PUT', endpoint, body),
  delete: <T = any>(endpoint: string) => request<T>('DELETE', endpoint),
};