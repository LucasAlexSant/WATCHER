'use client';

import { useEffect, useRef, useState } from 'react';
import type { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { Activity, AudioLines, Headphones, Mic, MicOff, Phone, PhoneOff, Radio } from 'lucide-react';
import { connectTranscript, type TranscriptLine, type TranscriptSession } from './transcript';
import { TranscriptPanel } from './TranscriptPanel';
import { WarRoomPanel, type RoomContext } from './WarRoomPanel';

type Preview = { id: number; title: string; priority: string; state: string; mode: 'operations' | 'briefing'; pix?: { approval_baseline_pct: number; simulated_approval_pct: number } };
type Credentials = { callId: string; appId: string; token: string; channel: string; uid: number; agentUid: number; expiresIn: number };
type Connection = { id: string; client: IAgoraRTCClient; mic?: IMicrophoneAudioTrack; timer?: number; joinTimer?: number; receivingAudio?: boolean; transcript?: TranscriptSession; submitted: Set<string>; reports: Promise<void>;
  measuring?: number; watchedRtmState?: boolean;
  summaryTimer?: number; voiceCloseTimer?: number; closeAfterTurn?: string; latestUserTurn?: string; farewellReceived?: boolean;
};
type Phase = 'loading' | 'preparing' | 'ringing' | 'connecting' | 'live' | 'ending' | 'ended' | 'invalid';

function microphoneMessage(issue: unknown) {
  const detail = issue as { code?: string; name?: string; message?: string } | null;
  if (detail?.code === 'PERMISSION_DENIED' || detail?.name === 'NotAllowedError' ||
      /permission.denied|notallowederror/i.test(detail?.message ?? '')) {
    return 'O navegador bloqueou o microfone. Permita o acesso nas configurações deste site ou abra o link no Chrome ou Edge.';
  }
  return 'Não foi possível usar o microfone. Confira o dispositivo de entrada ou atenda só para ouvir.';
}

function asksToEnd(text: string) {
  const clause = (text.toLowerCase().split(/[.!?,;:]+/).map(part => part.trim()).filter(Boolean).at(-1) ?? '')
    .replace(/^(?:eu )?(?:já )?(?:terminei|concluí|fiz) (?:o |a )?(?:rollback|reversão) (?:e )?/, '');
  return /^(?:(?:vamos|podemos|pode) (?:encerrar|terminar|finalizar)(?: (?:a )?(?:chamada|conversa))?|(?:encerre|termine|finalize) (?:a )?(?:chamada|conversa))(?: por favor)?$/.test(clause);
}

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
  if (connection.summaryTimer) window.clearTimeout(connection.summaryTimer);
  if (connection.voiceCloseTimer) window.clearTimeout(connection.voiceCloseTimer);
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
  const [microphoneActive, setMicrophoneActive] = useState(false);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [microphoneError, setMicrophoneError] = useState('');
  const [recapStatus, setRecapStatus] = useState('');
  const summarizing = useRef(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const analysisRequested = useRef(false);
  const invite = useRef('');
  const connection = useRef<Connection | null>(null);

  useEffect(() => {
    let cancelled = false;
    invite.current = window.location.hash.slice(1);
    if (!invite.current && new URLSearchParams(window.location.search).get('preparando') === '1') {
      setPhase('preparing');
      return;
    }
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
        if (current.summaryTimer) window.clearTimeout(current.summaryTimer);
        if (current.voiceCloseTimer) window.clearTimeout(current.voiceCloseTimer);
        void current.transcript?.close().catch(() => undefined);
        const payload = JSON.stringify({ action: 'stop', token: invite.current, callId: current.id });
        navigator.sendBeacon('/api/calls', new Blob([payload], { type: 'application/json' }));
      }
    }
    window.addEventListener('pagehide', onClose);
    return () => { cancelled = true; window.removeEventListener('pagehide', onClose); };
  }, []);

  async function refreshRoom() {
    const context = await callApi<RoomContext>({
      action: 'context', token: invite.current, callId: connection.current?.id,
    });
    setRoom(context);
  }

  useEffect(() => {
    if (!preview) return;
    const refresh = () => void refreshRoom().catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, [preview]);

  async function updateSummary() {
    if (summarizing.current) return;
    summarizing.current = true;
    setSummaryBusy(true);
    setRecapStatus('NeuraLake está consolidando as atualizações.');
    try {
      await connection.current?.reports;
      const result = await callApi<{ status: 'updated' | 'no_updates' }>(
        { action: 'summarize', token: invite.current }, { timeout: 50000 },
      );
      setRecapStatus(result.status === 'updated' ? 'Estado consolidado pelo NeuraLake.' : 'Nenhum relato novo para consolidar.');
      void refreshRoom().catch(() => undefined);
    } catch {
      setRecapStatus('Não foi possível atualizar agora. O último estado salvo continua disponível.');
    } finally {
      summarizing.current = false;
      setSummaryBusy(false);
    }
  }

  useEffect(() => {
    if (phase !== 'live' || preview?.mode !== 'operations') return;
    const timer = window.setInterval(() => void updateSummary(), 120000);
    return () => window.clearInterval(timer);
  }, [phase, preview?.mode]);

  function scheduleSummary(current: Connection) {
    if (connection.current !== current) return;
    if (current.summaryTimer) window.clearTimeout(current.summaryTimer);
    current.summaryTimer = window.setTimeout(() => {
      if (connection.current !== current) return;
      if (summarizing.current) scheduleSummary(current);
      else void updateSummary();
    }, 3000);
  }

  function followVoiceClose(current: Connection, messages: TranscriptLine[]) {
    const user = messages.filter(line => line.speaker === 'user' && line.state === 'complete').at(-1);
    if (user && user.id !== current.latestUserTurn) {
      current.latestUserTurn = user.id;
      if (current.voiceCloseTimer) window.clearTimeout(current.voiceCloseTimer);
      current.closeAfterTurn = asksToEnd(user.text) ? user.id : undefined;
      current.farewellReceived = false;
      if (current.closeAfterTurn) {
        current.voiceCloseTimer = window.setTimeout(() => {
          if (connection.current === current) void end();
        }, 18000);
      }
    }
    if (!current.closeAfterTurn || current.farewellReceived) return;
    const requestedAt = messages.findIndex(line => line.id === current.closeAfterTurn);
    if (requestedAt < 0 || !messages.slice(requestedAt + 1).some(line => line.speaker === 'agent' && line.state === 'complete')) return;
    current.farewellReceived = true;
    if (current.voiceCloseTimer) window.clearTimeout(current.voiceCloseTimer);
    current.voiceCloseTimer = window.setTimeout(() => {
      if (connection.current === current) void end();
    }, 1500);
  }

  useEffect(() => {
    if (!room || preview?.mode !== 'operations' || room.changes.length || analysisRequested.current) return;
    analysisRequested.current = true;
    void callApi({ action: 'analyzeChanges', token: invite.current }, { timeout: 36000 })
      .then(refreshRoom).catch(() => undefined);
  }, [preview?.mode, room]);

  function saveReports(current: Connection, messages: TranscriptLine[]) {
    if (preview?.mode !== 'operations') return;
    for (const line of messages) {
      if (line.state !== 'complete' || current.submitted.has(line.id)) continue;
      current.submitted.add(line.id);
      current.reports = current.reports.then(async () => {
        const payload = {
          action: 'report', token: invite.current, callId: current.id,
          turnId: line.id, speaker: line.speaker === 'user' ? 'engineer' : 'assistant', text: line.text,
        };
        const save = () => callApi(payload, { timeout: 8000, keepalive: true });
        try {
          await save().catch(save);
          setSaveStatus('Conversa do plantão registrada.');
          void refreshRoom().catch(() => undefined);
          scheduleSummary(current);
        } catch {
          current.submitted.delete(line.id);
          setSaveStatus('Uma fala da conversa ainda não foi salva.');
        }
      });
    }
  }

  async function end() {
    const current = connection.current;
    if (!current) return;
    connection.current = null;
    setPhase('ending');
    setSpeaking(false);
    setMicrophoneActive(false);
    setMicrophoneMuted(false);
    try {
      await Promise.all([
        release(current),
        current.reports.then(() => callApi({ action: 'stop', token: invite.current, callId: current.id })),
      ]);
    } catch {
      setError('Seu microfone foi desligado. A Agora não confirmou o encerramento do agente.');
    }
    setPhase('ended');
  }

  async function enableMicrophone() {
    const active = connection.current;
    if (!active || active.mic || microphoneBusy) return;
    setMicrophoneBusy(true);
    setMicrophoneError('');
    let track: IMicrophoneAudioTrack | undefined;
    try {
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      track = await AgoraRTC.createMicrophoneAudioTrack();
      if (connection.current !== active) return;
      await active.client.publish(track);
      if (connection.current !== active) return;
      active.mic = track;
      track = undefined;
      setMicrophoneActive(true);
      setMicrophoneMuted(false);
    } catch (issue) {
      if (connection.current === active) setMicrophoneError(microphoneMessage(issue));
    } finally {
      track?.close();
      setMicrophoneBusy(false);
    }
  }

  async function toggleMute() {
    const active = connection.current;
    if (!active?.mic || microphoneBusy) return;
    setMicrophoneBusy(true);
    setMicrophoneError('');
    try {
      await active.mic.setMuted(!microphoneMuted);
      if (connection.current === active) setMicrophoneMuted(!microphoneMuted);
    } catch {
      if (connection.current === active) setMicrophoneError('Não foi possível alterar o estado do microfone.');
    } finally {
      setMicrophoneBusy(false);
    }
  }

  async function answer(listenOnly = false) {
    setError('');
    setMicrophoneError('');
    setMicrophoneActive(false);
    setMicrophoneMuted(false);
    setPhase('connecting');
    setLines([]);
    setSpeaking(false);
    setRecapStatus('');
    setTranscriptStatus('connecting');
    let prepared: Credentials | undefined;
    let microphone: IMicrophoneAudioTrack | undefined;
    try {
      const { default: AgoraRTC } = await import('agora-rtc-sdk-ng');
      if (!listenOnly) {
        try {
          microphone = await AgoraRTC.createMicrophoneAudioTrack();
        } catch (issue) {
          setMicrophoneError(microphoneMessage(issue));
          setPhase('ringing');
          return;
        }
      }
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      prepared = await callApi<Credentials>({ action: 'prepare', token: invite.current });
      const active: Connection = { id: prepared.callId, client, mic: microphone, submitted: new Set(), reports: Promise.resolve() };
      microphone = undefined;
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
      await client.join(prepared.appId, prepared.channel, prepared.token, prepared.uid);
      if (active.mic) {
        await client.publish(active.mic);
        setMicrophoneActive(true);
      }
      try {
        active.transcript = await connectTranscript(client, prepared, messages => {
          if (connection.current === active) {
            setLines(messages);
            saveReports(active, messages);
            followVoiceClose(active, messages);
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
      microphone?.close();
      const current = connection.current;
      connection.current = null;
      await Promise.allSettled([
        current ? release(current) : Promise.resolve(),
        prepared ? callApi({ action: 'stop', token: invite.current, callId: prepared.callId }) : Promise.resolve(),
      ]);
      setMicrophoneActive(false);
      setError(issue instanceof Error ? issue.message : 'Não foi possível atender.');
      setPhase('ringing');
    }
  }

  const status: Record<Phase, string> = {
    loading: 'Validando link', preparing: 'Preparando chamada', ringing: 'Chamada recebida', connecting: 'Conectando ao agente',
    live: 'Em chamada', ending: 'Encerrando chamada', ended: 'Chamada encerrada', invalid: 'Link indisponível',
  };
  const showTranscript = phase === 'connecting' || phase === 'live' || phase === 'ending' || phase === 'ended';
  return <>
    <header className="site-header"><div className="header-inner"><span className="brand"><Activity size={22} /> WATCHER</span></div></header>
    <main className={showTranscript ? "call-wrap with-transcript" : "call-wrap"}>
      <section className="call-card">
        <div className={`call-avatar ${speaking ? 'agent-speaking' : ''}`} aria-label={speaking ? 'Assistente falando' : 'Assistente de voz'}>
          <AudioLines size={28} aria-hidden="true" />
        </div>
        <p className="eyebrow"><Radio size={16} /> Central de operações</p>
        <h1>{status[phase]}</h1>
        <p className="subtitle">{preview?.mode === "briefing" ? "Copiloto de incidentes · CTO" : "War room · Assistente de voz da Agora"}</p>
        {preview && <div className="call-brief">
          <strong>{preview.title}</strong>
          <p>Incidente #{preview.id} · {preview.priority} · {preview.state === 'RESOLVED' ? 'Resolvido' : 'Diagnosticado'}</p>
          {preview.pix && <p>Aprovação do PIX: {preview.pix.approval_baseline_pct.toLocaleString('pt-BR')}% → {preview.pix.simulated_approval_pct}%</p>}
        </div>}
        {error && <p role="alert" className="red">{error}</p>}
        {microphoneError && <p role="alert" className="red">{microphoneError}</p>}
        <div className="call-actions">
          {phase === 'ringing' && <button className="button primary" onClick={() => void answer()}><Phone size={18} /> Atender</button>}
          {phase === 'ringing' && <button className="button secondary" onClick={() => void answer(true)}><Headphones size={18} /> Só ouvir</button>}
          {phase === 'live' && !microphoneActive && <button className="button secondary" disabled={microphoneBusy}
            onClick={() => void enableMicrophone()}><Mic size={18} /> Ativar microfone</button>}
          {phase === 'live' && <div className="live-call-controls">
            {microphoneActive && <button className="button secondary mute-button" type="button" disabled={microphoneBusy}
              aria-label={microphoneMuted ? 'Reativar microfone' : 'Silenciar microfone'}
              title={microphoneMuted ? 'Reativar microfone' : 'Silenciar microfone'}
              data-muted={microphoneMuted} onClick={() => void toggleMute()}>
              {microphoneMuted ? <MicOff size={19} /> : <Mic size={19} />}
            </button>}
            <button className="button secondary" onClick={() => void end()}><PhoneOff size={18} /> Encerrar chamada</button>
          </div>}
        </div>
        {phase === 'preparing' && <p className="call-hint" role="status">A chamada abrirá aqui assim que a triagem do incidente terminar.</p>}
        {phase === 'ringing' && <p className="call-hint">Ao atender, permita o microfone. {preview?.mode === "operations" && "As falas concluídas da chamada alimentam o histórico do incidente."}</p>}
      </section>
      {showTranscript && <TranscriptPanel room={room} lines={lines} status={transcriptStatus} ended={phase === 'ended'} />}
      <WarRoomPanel room={room} saveStatus={saveStatus} recapStatus={recapStatus}
        onSummarize={preview?.mode === 'operations' ? updateSummary : undefined} summaryBusy={summaryBusy} />
    </main>
  </>;
}
