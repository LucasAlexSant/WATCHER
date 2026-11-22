'use client';

import { useState } from 'react';
import { Copy, Phone } from 'lucide-react';

type Invite = { url: string; expiresAt: number; recipient: { name: string; assigned: boolean } };

export function CallInvite({ incidentId }: { incidentId?: number }) {
  const [invite, setInvite] = useState<Invite>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setInvite(undefined);
    setCopied(false);
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/api/calls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', incidentId }),
        signal: AbortSignal.timeout(25000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setInvite(result);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Falha ao gerar o link.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setError('Selecione o endereço no campo para copiar.');
    }
  }

  return <div className="call-invite">
    <button className="button secondary" onClick={() => void create()} disabled={busy}>
      <Phone size={18} /> {busy ? 'Gerando link…' : incidentId ? 'Gerar acionamento' : 'Acionar último incidente PIX'}
    </button>
    {invite && <div className="invite-detail">
      <p><b>{invite.recipient.name}</b> · {invite.recipient.assigned ? 'Responsável cadastrado' : 'Sem engenheiro individual cadastrado'}.</p>
      <p>Link válido até {new Date(invite.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</p>
      <input aria-label="Link para atender a chamada" value={invite.url} readOnly onFocus={event => event.currentTarget.select()} />
      <div className="invite-actions">
        <a className="button primary" href={invite.url} target="_blank" rel="noopener noreferrer"><Phone size={16} /> Abrir chamada</a>
        <button className="button secondary" onClick={() => void copy()}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar link'}</button>
      </div>
    </div>}
    {error && <p className="red" role="alert">{error}</p>}
  </div>;
}
