export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? 'Não foi possível acessar o SOS Live.');
  return payload as T;
}

export function send(method: 'POST' | 'PATCH', data: unknown, owner?: string): RequestInit {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (owner) headers.set('Authorization', `Bearer ${owner}`);
  return { method, headers, body: JSON.stringify(data) };
}

export function sendReport(data: unknown, photos: File[], owner?: string): RequestInit {
  if (!photos.length) return send('POST', data, owner);
  const form = new FormData();
  form.set('payload', JSON.stringify(data));
  for (const photo of photos) form.append('photos', photo);
  return { method: 'POST', body: form, headers: owner ? { Authorization: `Bearer ${owner}` } : undefined };
}
