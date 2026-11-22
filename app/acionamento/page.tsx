'use client';

import { useEffect, useRef, useState } from 'react';
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { Activity, AudioLines, Phone, PhoneOff, Radio } from 'lucide-react';
import { connectTranscript, type TranscriptLine, type TranscriptSession } from './transcript';
import { TranscriptPanel } from './TranscriptPanel';
import { ChangesPanel, WarRoomPanel, type RoomContext } from './WarRoomPanel';

type Preview = { id: number; title: string; priority: string; state: string; mode: 'operations' | 'briefing'; pix?: { approval_baseline_pct: number; simulated_approval_pct: number } };
type Credentials = { callId: string; appId: string; token: string; channel: string; uid: number; agentUid: number; expiresIn: number };
type Connection = { id: string; client: IAgoraRTCClient; mic?: IMicrophoneAudioTrack; timer?: number; joinTimer?: number; receivingAudio?: boolean; transcript?: TranscriptSession; submitted: Set<string>; reports: Promise<void>;
  recap?: { bucket: number; knownTurns: Set<string>; deadline: number };
  measuring?: number; watchedRtmState?: boolean;
};
type Phase = 'loading' | 'ringing' | 'connecting' | 'live' | 'ending' | 'ended' | 'invalid';

async function callApi<T>(payload: object, options: { timeout?: number; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch('/api/calls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeout ?? 25000), keepalive: options.keepalive,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'O acionamento não está disponível.');
  return body as T;
}

async function release(connection: Connection) {
  if (connection.timer) window.clearTimeout(connection.timer);
  if (connection.joinTimer) window.clearTimeout(connection.joinTimer);
  connection.mic?.close();
  if (connection.measuring) window.clearInterval(connection.measuring);
  void connection.transcript?.close().catch(() => undefined);
  await connection.client.leave().catch(() => undefined);
  connection.client.removeAllListeners();
}

export default function CallPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [room, setRoom] = useState<RoomContext>();
  const [saveStatus, setSaveStatus] = useState('');
  const [transcriptStatus, setTranscriptStatus] = useState<'connecting' | 'ready' | 'unavailable'>('connecting');
  const [speaking, setSpeaking] = useState(false);
  const [recapStatus, setRecapStatus] = useState('');
  const [changeStatus, setChangeStatus] = useState('');
  const [changeBusy, setChangeBusy] = useState(false);
  const latestLines = useRef<TranscriptLine[]>([]);
  const analysisRequested = useRef(false);
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
        if (current.measuring) window.clearInterval(current.measuring);
        void current.transcript?.close().catch(() => undefined);
        const payload = JSON.stringify({ action: 'stop', token: invite.current, callId: current.id });
        navigator.sendBeacon('/api/calls', new Blob([payload], { type: 'application/json' }));
      }
    }
    window.addEventListener('pagehide', onClose);
    return () => { cancelled = true; window.removeEventListener('pagehide', onClose); };
  }, []);

  async function refreshRoom() {
    const context = await callApi<RoomContext>({ action: 'context', token: invite.current });
    setRoom(context);
  }

  useEffect(() => {
    if (!preview) return;
    const refresh = () => void refreshRoom().catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, [preview]);

  useEffect(() => {
    if (phase !== 'live' || preview?.mode !== 'operations') return;
    let bucket = 0;
    let deadlineTimer: number | undefined;
    const timer = window.setInterval(() => {
      const active = connection.current;
      if (!active?.transcript) {
        setRecapStatus('Resumo periódico depende da conexão da transcrição.');
        return;
      }
      bucket += 1;
      const recap = { bucket, knownTurns: new Set(latestLines.current.map(line => line.id)), deadline: Date.now() + 55000 };
      active.recap = recap;
      setRecapStatus('O agente está preparando o resumo periódico.');
      deadlineTimer = window.setTimeout(() => {
        if (connection.current === active && active.recap === recap) {
          active.recap = undefined;
          setRecapStatus('O resumo deste intervalo não foi concluído.');
        }
      }, 55000);
      void active.transcript.requestRecap().catch(() => {
        if (connection.current === active && active.recap === recap) {
          active.recap = undefined;
          setRecapStatus('Não foi possível solicitar este resumo ao agente.');
        }
      });
    }, 120000);
    return () => {
      window.clearInterval(timer);
      if (deadlineTimer !== undefined) window.clearTimeout(deadlineTimer);
    };
  }, [phase, preview?.mode]);

  function saveRecap(current: Connection, messages: TranscriptLine[]) {
    const pending = current.recap;
    if (!pending || pending.deadline <= Date.now()) return;
    const line = messages.find(item => item.speaker === 'agent' && item.state === 'complete' &&
      !pending.knownTurns.has(item.id) && /^resumo do war[ -]?room[.:\s–-]*estado\b/i.test(item.text));
    if (!line) return;
    current.recap = undefined;
    const payload = { action: 'recap', token: invite.current, callId: current.id, bucket: pending.bucket, text: line.text };
    const save = () => callApi(payload, { timeout: 16000, keepalive: true });
    current.reports = current.reports.then(async () => {
      try {
        await save().catch(save);
        setRecapStatus('Resumo periódico e planejamento salvos.');
        void refreshRoom().catch(() => undefined);
      } catch {
        setRecapStatus('O resumo foi falado, mas o registro ainda não foi confirmado.');
      }
    });
  }

  async function reviewChanges(changeId?: string) {
    setChangeBusy(true);
    setChangeStatus('');
    try {
      await callApi({ action: changeId ? 'shareChange' : 'analyzeChanges', token: invite.current, changeId }, { timeout: 36000 });
      await refreshRoom();
      setChangeStatus(changeId ? 'Card compartilhado na transcrição.' : 'Análise das GMUDs atualizada.');
    } catch (issue) {
      setChangeStatus(issue instanceof Error ? issue.message : 'Não foi possível analisar as mudanças.');
    } finally {
      setChangeBusy(false);
    }
  }

  useEffect(() => {
    if (!room || preview?.mode !== 'operations' || room.changes.length || analysisRequested.current) return;
    analysisRequested.current = true;
    void reviewChanges();
  }, [preview?.mode, room]);

  function saveReports(current: Connection, messages: TranscriptLine[]) {
    if (preview?.mode !== 'operations') return;
    for (const line of messages) {
      if (line.speaker !== 'user' || line.state !== 'complete' || current.submitted.has(line.id)) continue;
      current.submitted.add(line.id);
      current.reports = current.reports.then(async () => {
        const payload = { action: 'report', token: invite.current, callId: current.id, turnId: line.id, text: line.text };
        const save = () => callApi(payload, { timeout: 8000, keepalive: true });
        try {
          await save().catch(save);
          setSaveStatus('Relatos do plantão salvos no Supabase.');
          void refreshRoom().catch(() => undefined);
        } catch {
          current.submitted.delete(line.id);
          setSaveStatus('Uma fala do plantão ainda não foi salva.');
        }
      });
    }
  }

  async function end() {
    setPhase('ending');
    setSpeaking(false);
    const current = connection.current;
    connection.current = null;
    if (current) {
      try {
        await Promise.all([
          release(current),
          current.reports.then(() => callApi({ action: 'stop', token: invite.current, callId: current.id })),
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
    setLines([]);
    latestLines.current = [];
    setSpeaking(false);
    setRecapStatus('');
    setTranscriptStatus('connecting');
    let prepared: Credentials | undefined;
    try {
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      prepared = await callApi<Credentials>({ action: 'prepare', token: invite.current });
      const active: Connection = { id: prepared.callId, client, submitted: new Set(), reports: Promise.resolve() };
      connection.current = active;
      const { agentUid } = prepared;
      client.on('user-published', async (user, mediaType) => {
        if (mediaType !== 'audio' || String(user.uid) !== String(agentUid)) return;
        try {
          await client.subscribe(user, 'audio');
          if (connection.current === active) {
            if (!user.audioTrack) throw new Error('Missing remote audio track');
            const track = user.audioTrack;
            track.play();
            if (active.measuring) window.clearInterval(active.measuring);
            let lastVoice = 0;
            active.measuring = window.setInterval(() => {
              if (connection.current !== active || active.watchedRtmState) return;
              if (track.getVolumeLevel() > 0.025) lastVoice = Date.now();
              setSpeaking(Date.now() - lastVoice < 320);
            }, 100);
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
      try {
        active.transcript = await connectTranscript(client, prepared, messages => {
          if (connection.current === active) {
            latestLines.current = messages;
            setLines(messages);
            saveReports(active, messages);
            saveRecap(active, messages);
          }
        }, isSpeaking => {
          if (connection.current === active) {
            active.watchedRtmState = true;
            setSpeaking(isSpeaking);
          }
        });
        if (connection.current === active) setTranscriptStatus('ready');
      } catch {
        if (connection.current === active) setTranscriptStatus('unavailable');
      }
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
  const showTranscript = phase === 'connecting' || phase === 'live' || phase === 'ending' || phase === 'ended';
  return <>
    <header className="site-header"><div className="header-inner"><span className="brand"><Activity size={22} /> SOS Live</span></div></header>
    <main className={showTranscript ? "call-wrap with-transcript" : "call-wrap"}>
      <section className="call-card">
        <div className={`call-avatar ${speaking ? 'agent-speaking' : ''}`} aria-label={speaking ? 'Assistente falando' : 'Assistente de voz'}>
          <AudioLines size={28} aria-hidden="true" />
        </div>
        <p className="eyebrow"><Radio size={16} /> Central de operações</p>
        <h1>{status[phase]}</h1>
        <p className="subtitle">{preview?.mode === "briefing" ? "War room · Consulta para liderança" : "War room · Assistente de voz da Agora"}</p>
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
        {phase === 'ringing' && <p className="call-hint">Ao atender, permita o microfone. {preview?.mode === "operations" && "As falas concluídas do plantão alimentam o histórico do incidente."}</p>}
      </section>
      {showTranscript && <TranscriptPanel room={room} lines={lines} status={transcriptStatus} ended={phase === 'ended'} />}
      <WarRoomPanel room={room} saveStatus={saveStatus} recapStatus={recapStatus} />
      {room && <ChangesPanel room={room} status={changeStatus} busy={changeBusy} canEdit={preview?.mode === 'operations'} onAction={reviewChanges} />}
    </main>
  </>;
}
