'use client';

import { useEffect, useRef, useState } from 'react';
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { Activity, Phone, PhoneOff, Radio } from 'lucide-react';

type Preview = { id: number; title: string; priority: string; state: string; pix?: { approval_baseline_pct: number; simulated_approval_pct: number } };
type Credentials = { callId: string; appId: string; token: string; channel: string; uid: number; agentUid: number; expiresIn: number };
type Connection = { id: string; client: IAgoraRTCClient; mic?: IMicrophoneAudioTrack; timer?: number; joinTimer?: number; receivingAudio?: boolean };
type Phase = 'loading' | 'ringing' | 'connecting' | 'live' | 'ending' | 'ended' | 'invalid';

async function callApi<T>(payload: object): Promise<T> {
  const response = await fetch('/api/calls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'O acionamento não está disponível.');
  return body as T;
}

async function release(connection: Connection) {
  if (connection.timer) window.clearTimeout(connection.timer);
  if (connection.joinTimer) window.clearTimeout(connection.joinTimer);
  connection.mic?.close();
  await connection.client.leave().catch(() => undefined);
  connection.client.removeAllListeners();
}

export default function CallPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const invite = useRef('');
  const connection = useRef<Connection | null>(null);

  useEffect(() => {
    let cancelled = false;
    invite.current = window.location.hash.slice(1);
    callApi<Preview>({ action: 'preview', token: invite.current }).then(item => {
      if (!cancelled) { setPreview(item); setPhase('ringing'); }
    }).catch(issue => {
      if (!cancelled) { setError(issue.message); setPhase('invalid'); }
    });
    function onClose() {
      const current = connection.current;
      if (current) {
        current.mic?.close();
        const payload = JSON.stringify({ action: 'stop', token: invite.current, callId: current.id });
        navigator.sendBeacon('/api/calls', new Blob([payload], { type: 'application/json' }));
      }
    }
    window.addEventListener('pagehide', onClose);
    return () => { cancelled = true; window.removeEventListener('pagehide', onClose); };
  }, []);

  async function end() {
    setPhase('ending');
    const current = connection.current;
    connection.current = null;
    if (current) {
      try {
        await Promise.all([
          release(current),
          callApi({ action: 'stop', token: invite.current, callId: current.id }),
        ]);
      } catch {
        setError('Seu microfone foi desligado. A Agora não confirmou o encerramento do agente.');
      }
    }
    setPhase('ended');
  }

  async function answer() {
    setError('');
    setPhase('connecting');
    let prepared: Credentials | undefined;
    try {
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      prepared = await callApi<Credentials>({ action: 'prepare', token: invite.current });
      const active: Connection = { id: prepared.callId, client };
      connection.current = active;
      const { agentUid } = prepared;
      client.on('user-published', async (user, mediaType) => {
        if (mediaType !== 'audio' || String(user.uid) !== String(agentUid)) return;
        try {
          await client.subscribe(user, 'audio');
          if (connection.current === active) {
            if (!user.audioTrack) throw new Error('Missing remote audio track');
            user.audioTrack.play();
            active.receivingAudio = true;
            if (active.joinTimer) window.clearTimeout(active.joinTimer);
            setPhase('live');
          }
        } catch {
          if (connection.current === active) setError('Não foi possível reproduzir o áudio do agente.');
        }
      });
      client.on('user-left', user => {
        if (String(user.uid) === String(agentUid) && connection.current === active) void end();
      });
      active.mic = await AgoraRTC.createMicrophoneAudioTrack();
      await client.join(prepared.appId, prepared.channel, prepared.token, prepared.uid);
      await client.publish(active.mic);
      await callApi({ action: 'start', token: invite.current, callId: active.id });
      if (connection.current === active) {
        active.timer = window.setTimeout(() => void end(), Math.max(1, prepared.expiresIn - 45) * 1000);
        if (!active.receivingAudio) {
          active.joinTimer = window.setTimeout(() => {
            setError('O agente não publicou áudio a tempo. Gere outro link para tentar novamente.');
            void end();
          }, 25000);
        }
      }
    } catch (issue) {
      const current = connection.current;
      connection.current = null;
      await Promise.allSettled([
        current ? release(current) : Promise.resolve(),
        prepared ? callApi({ action: 'stop', token: invite.current, callId: prepared.callId }) : Promise.resolve(),
      ]);
      setError(issue instanceof Error ? issue.message : 'Não foi possível atender.');
      setPhase('ringing');
    }
  }

  const status: Record<Phase, string> = {
    loading: 'Validando link', ringing: 'Chamada recebida', connecting: 'Conectando ao agente',
    live: 'Em chamada', ending: 'Encerrando chamada', ended: 'Chamada encerrada', invalid: 'Link indisponível',
  };
  return <>
    <header className="site-header"><div className="header-inner"><span className="brand"><Activity size={22} /> SOS Live</span></div></header>
    <main className="call-wrap">
      <section className="call-card">
        <div className="call-avatar"><Phone size={28} /></div>
        <p className="eyebrow"><Radio size={16} /> Central de operações</p>
        <h1>{status[phase]}</h1>
        <p className="subtitle">Assistente de voz da Agora</p>
        {preview && <div className="call-brief">
          <strong>{preview.title}</strong>
          <p>Incidente #{preview.id} · {preview.priority} · {preview.state === 'RESOLVED' ? 'Resolvido' : 'Diagnosticado'}</p>
          {preview.pix && <p>Aprovação do PIX: {preview.pix.approval_baseline_pct.toLocaleString('pt-BR')}% → {preview.pix.simulated_approval_pct}%</p>}
        </div>}
        {error && <p role="alert" className="red">{error}</p>}
        <div className="call-actions">
          {phase === 'ringing' && <button className="button primary" onClick={() => void answer()}><Phone size={18} /> Atender</button>}
          {phase === 'live' && <button className="button secondary" onClick={() => void end()}><PhoneOff size={18} /> Encerrar chamada</button>}
        </div>
        {phase === 'ringing' && <p className="call-hint">Ao atender, permita o microfone para conversar com o agente.</p>}
      </section>
    </main>
  </>;
}
