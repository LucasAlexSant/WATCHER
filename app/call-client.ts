export async function callRequest<T>(data: object): Promise<T> {
  const response = await fetch('/api/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível acessar o war room.');
  return result as T;
}

export type CallInvitation = {
  url: string;
  expiresAt: number;
  recipient: { name: string; assigned: boolean };
};

export function reserveCallTab() {
  const tab = window.open('/acionamento?preparando=1', '_blank');
  if (tab) tab.opener = null;
  return tab;
}
