'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, List, LockKeyhole, LogOut, Radio, X } from 'lucide-react';
import type { RTMClient } from 'agora-rtm';
import { api, send } from '@/lib/browser-api';
import { categories, normalizeCity, protocol, verificationLabels, type Incident } from '@/lib/incidents';
import type { CentralAction, MapInstruction, MapMove } from '@/lib/central-actions';
import type { AgoraTokenData } from '@/types/conversation';
import { Review } from './Review';
import { OperationsInsights } from './OperationsInsights';
import { CentralRail, type CasePreview } from './CentralRail';
import { SiteHeader } from './SiteHeader';

const IncidentMap = dynamic(() => import('./IncidentMap'), { ssr: false,
  loading: () => <div className="map-frame map-loading">Carregando mapa…</div> });

export const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function Operations() {
  const [actor, setActor] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [checking, setChecking] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [code, setCode] = useState('');
  const [items, setItems] = useState<Incident[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('');
  const [verification, setVerification] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [signal, setSignal] = useState(false);
  const [detail, setDetail] = useState<CasePreview | null>(null);
  const [page, setPage] = useState(0);
  const [railHeight, setRailHeight] = useState(560);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [moves, setMoves] = useState<MapInstruction[]>([]);
  const reading = useRef(false);
  const sidePanel = useRef<HTMLElement>(null);
  const voiceToggle = useRef<HTMLButtonElement>(null);
  const voiceClose = useRef<HTMLButtonElement>(null);
  const nextMove = useRef(0);
  const reveal = useRef<string | null>(null);

  const queueMove = useCallback((move: MapMove) => {
    const sequence = ++nextMove.current;
    setMoves((previous) => [...previous.slice(-39), { sequence, move }]);
  }, []);

  const applyAction = useCallback((action: CentralAction) => {
    if (action.move) queueMove(action.move);
    if (action.kind === 'incident') {
      reveal.current = action.incidentId;
      setStateFilter('');
      setVerification('');
      setQuery('');
      setSelected(action.incidentId);
      setMobileOpen(true);
    }
    setNotice(action.message);
  }, [queueMove]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5500);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const rail = sidePanel.current;
    if (!rail || !actor) return;
    const observer = new ResizeObserver(([entry]) => setRailHeight(entry.contentRect.height));
    observer.observe(rail);
    return () => observer.disconnect();
  }, [actor]);

  const check = useCallback(async () => {
    try {
      const session = await api<{ actor: string | null; local?: boolean }>('/api/operator/session');
      setActor(session.actor);
      setLocal(Boolean(session.local));
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => { void check(); }, [check]);

  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const data = await api<{ incidents: Incident[] }>('/api/incidents', { signal: AbortSignal.timeout(6500) });
      setItems((previous) => previous.length === data.incidents.length
        && previous.every(({ id, version }, i) => id === data.incidents[i].id && version === data.incidents[i].version)
        ? previous : data.incidents);
      setHasSnapshot(true);
      setError('');
    } catch {
      setError('A central não conseguiu atualizar os relatos.');
      void check();
    } finally {
      reading.current = false;
    }
  }, [check]);

  useEffect(() => {
    if (!actor) return;
    let client: RTMClient | null = null;
    let stopped = false;
    const onMessage = () => { void refresh(); };
    async function connect() {
      try {
        const token = await api<AgoraTokenData | null>('/api/operator/signaling');
        if (!token || stopped) return;
        const { default: AgoraRTM } = await import('agora-rtm');
        if (stopped) return;
        const rtm = new AgoraRTM.RTM(token.appId, token.uid);
        client = rtm;
        rtm.addEventListener('message', onMessage);
        rtm.addEventListener('status', ({ state }) => { if (!stopped) setSignal(state === 'CONNECTED'); });
        rtm.addEventListener('tokenPrivilegeWillExpire', () => { if (!stopped) setSignal(false); });
        await rtm.login({ token: token.token });
        if (stopped) { await rtm.logout(); return; }
        await rtm.subscribe(token.channel);
        if (!stopped) setSignal(true);
      } catch {
        if (!stopped) setSignal(false);
      }
    }
    void refresh();
    void connect();
    const timer = setInterval(() => { void refresh(); }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
      client?.removeEventListener('message', onMessage);
      void client?.logout().catch(() => {});
    };
  }, [actor, refresh]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSigningIn(true);
    try {
      await api('/api/operator/session', send('POST', { code }));
      setCode('');
      await check();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSigningIn(false);
    }
  }

  async function logout() {
    try {
      await api('/api/operator/session', { method: 'DELETE' });
      setItems([]); setSelected(null); setReview(null); setDetail(null); setHasSnapshot(false); setSignal(false);
      setStateFilter(''); setVerification(''); setQuery(''); setMoves([]); setVoiceOpen(false); setMobileOpen(false); setNotice('');
      await check();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  const filtered = useMemo(() => items.filter((item) =>
    (!stateFilter || item.uf === stateFilter) && (!verification || item.verification === verification)
    && normalizeCity([categories[item.category], verificationLabels[item.verification], item.city, item.uf, item.description, protocol(item.id)]
      .filter(Boolean).join(' ')).includes(normalizeCity(query)),
  ), [items, stateFilter, verification, query]);
  const currentDetail = detail?.incident.id === selected ? detail : null;
  const selectedRow = items.find(({ id }) => id === selected);
  const current = selectedRow ?? currentDetail?.incident ?? null;
  const selectedVersion = selectedRow?.version;

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void api<CasePreview>(`/api/incidents/${selected}`, { signal: controller.signal })
      .then((record) => { if (!controller.signal.aborted) setDetail(record); })
      .catch(() => { if (!controller.signal.aborted) setNotice('Não foi possível abrir os detalhes da ocorrência.'); });
    return () => controller.abort();
  }, [selected, selectedVersion]);

  const pageSize = selected ? (railHeight < 510 ? 1 : 2) : Math.max(1, Math.min(8, Math.floor((railHeight - 252) / 58)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageIndex = Math.min(page, pages - 1);
  const visibleCases = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  useEffect(() => {
    if (!selected || reveal.current !== selected) return;
    const index = filtered.findIndex(({ id }) => id === selected);
    if (index >= 0) setPage(Math.floor(index / pageSize));
    reveal.current = null;
  }, [selected, filtered, pageSize]);

  const displayed = useMemo(() => current && !filtered.some(({ id }) => id === current.id) ? [...filtered, current] : filtered,
    [current, filtered]);

  const select = useCallback((id: string) => {
    reveal.current = id;
    setSelected(id);
    setMobileOpen(true);
    const point = items.find((item) => item.id === id)?.coordinates;
    if (point) queueMove({ kind: 'center', center: [point.longitude, point.latitude],
      zoom: point.precision === 'confirmed' ? 14 : 11.8 });
  }, [items, queueMove]);

  function toggleVoice() {
    setVoiceOpen(!voiceOpen);
    requestAnimationFrame(() => (voiceOpen ? voiceToggle : voiceClose).current?.focus());
  }

  return <>
    <SiteHeader workspace>
      {actor && <>
        {signal && <span className="central-signal" aria-label="Conectado via Agora Signaling" title="Conectado via Agora Signaling"><Radio size={16} /></span>}
        <button type="button" className="central-icon central-mobile-only" aria-label="Ocorrências" aria-controls="central-ocorrencias"
          aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><List size={19} /></button>
        <button type="button" className="central-icon" aria-label="Sair da Central" title="Sair" onClick={logout}><LogOut size={17} /></button>
      </>}
    </SiteHeader>

    {actor ? <div className="central-workspace">
      <section className="central-map" aria-label="Mapa operacional">
        <IncidentMap dispatch national incidents={displayed} selected={selected} onSelect={select} moves={moves} />
        {(notice || error) && <p className="central-notice" role="status">{!error && <Check size={17} />}{error || notice}</p>}
      </section>
      <CentralRail cases={visibleCases} current={current} detail={currentDetail} index={pageIndex} pages={pages}
        page={setPage} select={select} state={stateFilter} setState={(value) => {
          setStateFilter(value); setPage(0); setSelected(null);
          const points = items.filter((item) => item.uf === value && item.coordinates).map((item) => item.coordinates!);
          if (!value) queueMove({ kind: 'country' });
          else if (points.length === 1) queueMove({ kind: 'center', center: [points[0].longitude, points[0].latitude], zoom: 10.5 });
          else if (points.length) {
            const longitude = points.map((point) => point.longitude);
            const latitude = points.map((point) => point.latitude);
            queueMove({ kind: 'bounds', bounds: [[Math.min(...longitude) - 0.1, Math.min(...latitude) - 0.1],
              [Math.max(...longitude) + 0.1, Math.max(...latitude) + 0.1]] });
          }
        }} verification={verification} setVerification={(value) => { setVerification(value); setPage(0); setSelected(null); }}
        query={query} setQuery={(value) => { setQuery(value); setPage(0); setSelected(null); }}
        review={setReview} closeCase={() => { setSelected(null); setPage(0); }}
        voiceOpen={voiceOpen} toggleVoice={toggleVoice} voiceToggle={voiceToggle} mobileOpen={mobileOpen}
        toggleMobile={() => setMobileOpen(!mobileOpen)} ready={hasSnapshot} panel={sidePanel} />
      {voiceOpen && <section className="central-voice-dock" aria-labelledby="central-voz-titulo" id="central-voz"
        onKeyDown={(event) => { if (event.key === 'Escape') toggleVoice(); }}>
        <header><h2 id="central-voz-titulo">Consultar com a Agora</h2>
          <button ref={voiceClose} className="central-icon" type="button" aria-label="Fechar consulta" onClick={toggleVoice}><X size={18} /></button>
        </header>
        <OperationsInsights onAction={applyAction} />
      </section>}
      {review && <Review id={review} close={() => setReview(null)}
        saved={(updated) => { setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item)); void refresh(); }} />}
    </div> : <section className="panel operator-login">
      <div className="login-icon"><LockKeyhole size={23} /></div>
      <h1>Central de operações</h1>
      <p className="muted">Entre para acompanhar as ocorrências no mapa.</p>
      {checking ? <p role="status">Verificando acesso…</p>
        : <form className="fields" onSubmit={login}>
          <label>Código de acesso<input autoComplete="current-password" type="password" required value={code} maxLength={200}
            onChange={(event) => setCode(event.target.value)} /></label>
          {local && <p className="muted">Código da demonstração local <kbd>sos-local</kbd></p>}
          <button className="button primary" disabled={signingIn}>{signingIn ? 'Entrando…' : 'Entrar na central'}</button>
        </form>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>}
  </>;
}
