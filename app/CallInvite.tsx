'use client';

import { useState } from 'react';
import { Copy, Phone, Radio } from 'lucide-react';

import { callRequest, type CallInvitation } from './call-client';

export function CallInvite({ incidentId }: { incidentId?: number }) {
  const [invite, setInvite] = useState<CallInvitation>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'operations' | 'briefing'>('operations');

  async function create(nextMode: typeof mode) {
    setMode(nextMode);
    setInvite(undefined);
    setCopied(false);
    setError('');
    setBusy(true);
    try {
      setInvite(await callRequest<CallInvitation>({ action: 'invite', incidentId, mode: nextMode }));
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
    <div className="invite-actions">
    <button className="button secondary" onClick={() => void create('operations')} disabled={busy}>
      <Phone size={18} /> {busy ? 'Gerando link…' : incidentId ? 'Gerar acionamento' : 'Acionar último incidente PIX'}
    </button>
    <button className="button secondary" onClick={() => void create('briefing')} disabled={busy}>
      <Radio size={17} /> Link para o CTO
    </button>
    </div>
    {invite && <div className="invite-detail">
      <p><b>{invite.recipient.name}</b> · {mode === 'briefing' ? 'Acesso de consulta' : invite.recipient.assigned ? 'Responsável cadastrado' : 'Sem engenheiro individual cadastrado'}.</p>
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
