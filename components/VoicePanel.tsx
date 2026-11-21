'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { RTMClient } from 'agora-rtm';
import { Check, Mic, PhoneOff } from 'lucide-react';
import { api, send, sendReport } from '@/lib/browser-api';
import type { Coordinates, DeviceLocation, Report, VoiceDraft, VoiceMapEvent } from '@/lib/incidents';
import type { AgoraTokenData, VoiceSessionData } from '@/types/conversation';
import type { CentralAction, CentralEvent } from '@/lib/central-actions';
import { ReportSummary } from './ReportFields';
import { LocationPicker } from './LocationPicker';

const Conversation = dynamic(() => import('./ConversationComponent'), {
  ssr: false, loading: () => <p role="status" className="muted">Conectando o áudio…</p>,
});
const AgoraProvider = dynamic(async () => {
  const { AgoraRTCProvider, default: AgoraRTC } = await import('agora-rtc-react');
  return function Provider({ children }: { children: React.ReactNode }) {
    const client = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(null);
    client.current ??= AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    return <AgoraRTCProvider client={client.current}>{children}</AgoraRTCProvider>;
  };
}, { ssr: false });

type SessionView = { draft: VoiceDraft | null; receipt: string | null; state: string; mapEvent: VoiceMapEvent | null };
const url = (session: VoiceSessionData) => `/api/voice/session/${session.id}`;

function disconnect(session: VoiceSessionData, rtm: RTMClient | null) {
  void rtm?.logout().catch(() => {});
  void api(`${url(session)}/stop`, { method: 'POST', keepalive: true,
    headers: { Authorization: `Bearer ${session.owner}` } }).catch(() => {});
}

type ReportVoiceProps = {
  purpose?: 'report';
  switchToText: (report?: Report) => void; onReceipt: (protocol: string) => void;
  onDraftReport: (report: Report | null) => void;
  onMapEvent: (event: VoiceMapEvent | null) => void;
  device: DeviceLocation | null;
  photos: File[];
  locationOverride: Coordinates | null;
  onLocationChange: (location: Coordinates | null) => void;
  onShowMap: () => void;
  onUseDevice: () => void;
};

export function VoicePanel(props: ReportVoiceProps | { purpose: 'insights'; onCentralAction: (action: CentralAction) => void }) {
  const purpose = props.purpose ?? 'report';
  const reporter = props.purpose === 'insights' ? null : props;
  const device = reporter?.device ?? null;
  const onDraftReport = reporter?.onDraftReport;
  const onMapEvent = reporter?.onMapEvent;
  const onCentralAction = props.purpose === 'insights' ? props.onCentralAction : null;
  const [state, setState] = useState<'idle' | 'starting' | 'active' | 'ended'>('idle');
  const [session, setSession] = useState<VoiceSessionData | null>(null);
  const [rtm, setRtm] = useState<RTMClient | null>(null);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [receipt, setReceipt] = useState('');
  const [code, setCode] = useState('');
  const [codeRequired, setCodeRequired] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);
  const connection = useRef<{ session: VoiceSessionData; rtm: RTMClient | null } | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const sent = useRef('');
  const draftReport = draft?.report ?? null;

  useEffect(() => {
    onDraftReport?.(draftReport);
  }, [draftReport, onDraftReport]);
  useEffect(() => () => onDraftReport?.(null), [onDraftReport]);

  useEffect(() => {
    void api<{ voiceCodeRequired: boolean; voiceConfigured: boolean }>('/api/health')
      .then(({ voiceCodeRequired, voiceConfigured }) => { setCodeRequired(voiceCodeRequired); setConfigured(voiceConfigured); })
      .catch(() => {});
    function cleanup() {
      attempt.current?.abort();
      const active = connection.current;
      if (active) disconnect(active.session, active.rtm);
      connection.current = null;
    }
    window.addEventListener('pagehide', cleanup);
    return () => {
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (!session || receipt || purpose === 'insights') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let mapEventId = '';
    async function poll(active: VoiceSessionData) {
      try {
        const snapshot = await api<SessionView>(url(active), { signal: controller.signal,
          headers: { Authorization: `Bearer ${active.owner}` } });
        if (controller.signal.aborted) return;
        setDraft((previous) => previous?.revision === snapshot.draft?.revision ? previous : snapshot.draft);
        if (snapshot.mapEvent && snapshot.mapEvent.id !== mapEventId) {
          mapEventId = snapshot.mapEvent.id;
          onMapEvent?.(snapshot.mapEvent);
        }
        if (snapshot.receipt) setReceipt(snapshot.receipt);
      } catch {
        // The text fallback and the most recent draft remain available while reconnecting.
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(active), 900);
    }
    void poll(session);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session, receipt, purpose, onMapEvent]);

  useEffect(() => {
    if (!session || state !== 'active' || !onCentralAction) return;
    const controller = new AbortController();
    let cursor = '0';
    let timer: ReturnType<typeof setTimeout>;
    async function poll(active: VoiceSessionData) {
      try {
        const result = await api<{ commands: CentralEvent[] }>(`${url(active)}?after=${cursor}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4500)]),
          headers: { Authorization: `Bearer ${active.owner}` },
        });
        if (controller.signal.aborted) return;
        for (const event of result.commands) {
          onCentralAction?.(event.action);
          cursor = event.cursor;
        }
      } catch {
        // Keep the last applied cursor on a transient connection failure.
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(active), 650);
    }
    void poll(session);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [onCentralAction, session, state]);

  useEffect(() => {
    if (!session || receipt || purpose === 'insights') return;
    const controller = new AbortController();
    void api(url(session), { ...send('POST', { action: 'location', device }, session.owner), signal: controller.signal })
      .catch(() => {
        if (!controller.signal.aborted) setError('A localização continua no mapa. Informe o município ao agente se ele pedir.');
      });
    return () => controller.abort();
  }, [device, purpose, receipt, session]);

  async function begin() {
    setState('starting');
    setError('');
    onMapEvent?.(null);
    const controller = new AbortController();
    attempt.current = controller;
    let prepared: VoiceSessionData | null = null;
    let client: RTMClient | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('O microfone exige uma conexão segura.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      media.getTracks().forEach((track) => track.stop());
      controller.signal.throwIfAborted();
      prepared = await api<VoiceSessionData>('/api/voice/session', { ...send('POST', { code, purpose, device }), signal: controller.signal });
      if (controller.signal.aborted) { disconnect(prepared, null); return; }
      connection.current = { session: prepared, rtm: null };
      const { default: AgoraRTM } = await import('agora-rtm');
      controller.signal.throwIfAborted();
      client = new AgoraRTM.RTM(prepared.appId, prepared.uid);
      connection.current = { session: prepared, rtm: client };
      await client.login({ token: prepared.token });
      controller.signal.throwIfAborted();
      await client.subscribe(prepared.channel);
      await api(url(prepared), { ...send('POST', { action: 'start' }, prepared.owner), signal: controller.signal });
      controller.signal.throwIfAborted();
      setDraft(null);
      setSession(prepared);
      setRtm(client);
      setState('active');
    } catch (cause) {
      if (prepared) disconnect(prepared, client);
      connection.current = null;
      if (controller.signal.aborted) return;
      setError(cause instanceof Error && cause.name !== 'NotAllowedError' && cause.name !== 'NotFoundError'
        ? cause.message : 'O microfone não está disponível. Confira a permissão e tente novamente.');
      setState('idle');
    }
  }

  const end = useCallback(() => {
    const active = connection.current;
    if (active) disconnect(active.session, active.rtm);
    connection.current = null;
    setRtm(null);
    setState('ended');
  }, []);

  const renew = useCallback(async () => {
    if (!session) throw new Error('Sessão encerrada.');
    const result = await api<AgoraTokenData>(url(session), send('POST', { action: 'renew' }, session.owner));
    return { rtcToken: result.token, rtmToken: result.token };
  }, [session]);

  const point = reporter?.locationOverride ?? draft?.report.coordinates ?? null;

  async function confirm() {
    if (!session || !draft || !reporter) return;
    setWaiting(true);
    setError('');
    try {
      const result = await api<{ protocol: string }>(url(session), sendReport({
        action: 'confirm', confirmed: true, revision: draft.revision, coordinates: point,
      }, reporter.photos, session.owner));
      setReceipt(result.protocol);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tente enviar novamente.');
    } finally {
      setWaiting(false);
    }
  }

  return <div className="voice-panel">
    {state === 'active' && session && rtm
      ? <AgoraProvider><Conversation agoraData={session} rtmClient={rtm}
          onTokenWillExpire={renew} onEndConversation={end} /></AgoraProvider>
      : !draft && !receipt && <div className="voice-intro">
        <div className="mic-orbit"><Mic size={31} strokeWidth={1.8} /></div>
        <h2>{state === 'ended' ? 'Conversa encerrada' : reporter ? 'Converse com o agente' : 'Assistente da Central'}</h2>
        <p>{reporter ? 'O agente faz uma pergunta de cada vez e prepara um resumo para você conferir.'
          : 'Consulte as ocorrências, mova o mapa e abra relatos pelo protocolo.'}</p>
        {configured === false
          ? <><p className="muted" role="status">A voz está indisponível neste ambiente.</p>
            {reporter && <button type="button" className="button primary" onClick={() => reporter.switchToText()}>Relatar por texto</button>}</>
          : <>
            {reporter && codeRequired && <label className="voice-code">Código de acesso à voz<input type="password" value={code} maxLength={200} onChange={(e) => setCode(e.target.value)} /></label>}
            <button type="button" className="button primary" disabled={state === 'starting' || configured === null} onClick={begin}>
              <Mic size={18} /> {state === 'starting' ? 'Conectando…' : reporter ? 'Iniciar conversa' : 'Consultar por voz'}
            </button>
            <p className="privacy-note">Autorize o microfone para conversar.</p>
          </>}
      </div>}
    {reporter && draft && !receipt && <section className="review-block">
      <h2>Confira o resumo</h2>
      <p className="muted">{state === 'active' ? 'Se precisar corrigir algo, fale com o agente e aguarde o novo resumo.' : 'Revise os dados ou ajuste o relato por texto.'}</p>
      <ReportSummary report={{ ...draft.report, coordinates: point }} />
      {reporter.photos.length > 0 && <p className="muted">{reporter.photos.length} {reporter.photos.length === 1 ? 'foto anexada' : 'fotos anexadas'}</p>}
      <LocationPicker key={draft.revision} location={point} fallback={draft.report.coordinates} report={draft.report}
        onChange={reporter.onLocationChange} onShowMap={reporter.onShowMap} onUseDevice={reporter.onUseDevice} />
      <div className="action-row">
        <button type="button" className="button primary" onClick={confirm} disabled={waiting}><Check size={18} /> {waiting ? 'Enviando…' : 'Confirmar e enviar'}</button>
        <button type="button" className="button secondary" disabled={waiting} onClick={() => reporter.switchToText({ ...draft.report, coordinates: point })}>Editar por texto</button>
      </div>
    </section>}
    {reporter && receipt && <section className="review-block">
      <h2>Relato registrado</h2>
      <p role="status">Seu protocolo é <strong>{receipt}</strong>.</p>
      <button type="button" className="button secondary" onClick={() => {
        if (sent.current === receipt) return;
        sent.current = receipt;
        end();
        reporter.onReceipt(receipt);
      }}><PhoneOff size={17} /> Concluir</button>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
