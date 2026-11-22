'use client';

import { useEffect, useRef, useState } from 'react';
import { CallInvite } from './CallInvite';
import { callRequest, reserveCallTab, type CallInvitation } from './call-client';
import { SiteHeader } from './SiteHeader';
import type { Candidate, Comparison } from './api/alerts/candidates';
import {
  Activity, ArrowLeftRight, Bell, CheckCircle2, CreditCard, Database,
  Landmark, Phone, Radio, Server, Siren, TriangleAlert, Zap,
} from 'lucide-react';

type Status = 'normal' | 'warning' | 'critical';
type Monitor = {
  id: string;
  name: string;
  metric: string;
  unit: string;
  decimals?: number;
  normal: number;
  variation: number;
  incident?: { value: number; variation: number; status: Status; detail: string };
  icon: typeof Activity;
};

const monitors: Monitor[] = [
  { id: 'pix', name: 'PIX', metric: 'Taxa de aprovação', unit: '%', decimals: 1, normal: 99.7, variation: .15, incident: { value: 58, variation: 9, status: 'critical', detail: 'Transferências expiram antes da confirmação.' }, icon: Zap },
  { id: 'gateway', name: 'Gateway de pagamentos', metric: 'Latência p95', unit: 'ms', normal: 182, variation: 18, incident: { value: 1590, variation: 260, status: 'warning', detail: 'Novas tentativas de PIX aumentam a latência.' }, icon: ArrowLeftRight },
  { id: 'queue', name: 'Fila de conciliação', metric: 'Transações pendentes', unit: '', normal: 24, variation: 7, incident: { value: 390, variation: 44, status: 'warning', detail: 'Confirmações em atraso se acumulam na fila.' }, icon: Database },
  { id: 'card', name: 'Cartões', metric: 'Taxa de aprovação', unit: '%', decimals: 1, normal: 98.9, variation: .45, icon: CreditCard },
  { id: 'boleto', name: 'Boletos', metric: 'Emissões por minuto', unit: '/min', normal: 118, variation: 15, icon: Landmark },
  { id: 'api', name: 'API de contas', metric: 'Latência p95', unit: 'ms', normal: 96, variation: 13, icon: Server },
];

const labels: Record<Status, string> = { normal: 'Operacional', warning: 'Degradado', critical: 'Crítico' };
type IncidentResult = { status: 'recorded'; id: number; priority: string; source: string; comparisons: Comparison[] };
type AlertResult = IncidentResult | { status: 'started'; startedAt: string } | { status: 'pending'; candidates: Candidate[]; reason: string; retryIn: number } | { status: 'stopped' };

async function syncAlert(action: 'start' | 'check' | 'stop', id: string): Promise<AlertResult> {
  const response = await fetch('/api/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Falha na sincronização com o Supabase.');
  return result;
}

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function reading(monitor: Monitor, tick: number, active: boolean) {
  const { value, variation } = active && monitor.incident
    ? monitor.incident
    : { value: monitor.normal, variation: monitor.variation };
  return value + variation * (Math.sin(tick * 1.37 + monitor.name.length) * .65 + Math.cos(tick * .67) * .35);
}

function initialSamples() {
  return monitors.map(monitor => Array.from({ length: 24 }, (_, index) => reading(monitor, index - 23, false)));
}

function Sparkline({ monitor, points }: { monitor: Monitor; points: number[] }) {
  const target = monitor.incident?.value ?? monitor.normal;
  const padding = Math.max(monitor.variation, monitor.incident?.variation ?? 0) * 1.4;
  const low = Math.min(monitor.normal, target) - padding;
  const high = Math.max(monitor.normal, target) + padding;
  const line = points.map((value, index) => `${index * 240 / (points.length - 1)},${45 - (value - low) * 36 / (high - low)}`).join(' ');
  return <svg className="spark" viewBox="0 0 240 50" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 13H240 M0 29H240 M0 45H240" className="spark-grid" />
    <polygon points={`0,50 ${line} 240,50`} className="spark-fill" />
    <polyline points={line} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

export default function Page() {
  const [state, setState] = useState(() => ({ samples: initialSamples(), tick: 0, active: false, updatedAt: 0, incidentAt: 0 }));
  const [alertId, setAlertId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [incident, setIncident] = useState<IncidentResult>();
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState<{ candidates: Candidate[]; reason: string }>();
  const [retryAt, setRetryAt] = useState(0);
  const [autoInvite, setAutoInvite] = useState<CallInvitation>();
  const [callNotice, setCallNotice] = useState('');
  const reserved = useRef<{ alertId: string; tab: Window | null } | null>(null);

  function closeWaitingTab() {
    const request = reserved.current;
    reserved.current = null;
    if (request?.tab && !request.tab.closed) request.tab.close();
  }

  async function openIncidentCall(id: string, incidentId: number) {
    const request = reserved.current;
    if (!request || request.alertId !== id) return;
    setCallNotice('Preparando o acionamento do plantão.');
    try {
      const invitation = await callRequest<CallInvitation>({ action: 'invite', incidentId, mode: 'operations' });
      if (reserved.current !== request) return;
      setAutoInvite(invitation);
      if (request.tab && !request.tab.closed) {
        request.tab.location.replace(invitation.url);
        setCallNotice('Chamada do plantão aberta em outra guia.');
      } else {
        setCallNotice('A guia automática não está disponível. Abra a chamada pelo botão abaixo.');
      }
      reserved.current = null;
    } catch {
      if (reserved.current !== request) return;
      closeWaitingTab();
      setCallNotice('Não foi possível abrir a chamada automaticamente. Use Gerar acionamento.');
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setState(previous => advance(previous, previous.active, now));
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state.active || !alertId || incident || busy || checking || state.updatedAt < retryAt) return;
    setChecking(true);
    syncAlert('check', alertId).then(result => {
      if (result.status === 'recorded') {
        setIncident(result);
        setPending(undefined);
        setProblem('');
        void openIncidentCall(alertId, result.id);
      } else if (result.status === 'pending') {
        setPending({ candidates: result.candidates, reason: result.reason });
        setProblem('');
        setRetryAt(Date.now() + result.retryIn * 1000);
      } else {
        closeWaitingTab();
        setCallNotice('');
        const now = Date.now();
        setAlertId(undefined);
        setState(previous => ({ ...advance(previous, false, now), incidentAt: 0 }));
      }
    }).catch(error => {
      setProblem(error instanceof Error ? error.message : 'Falha na triagem.');
      setRetryAt(Date.now() + 10000);
    }).finally(() => setChecking(false));
  }, [alertId, busy, checking, incident, retryAt, state.active, state.updatedAt]);

  async function toggleIncident() {
    setBusy(true);
    setProblem('');
    const id = alertId ?? crypto.randomUUID();
    if (!state.active) {
      closeWaitingTab();
      reserved.current = { alertId: id, tab: reserveCallTab() };
      setAutoInvite(undefined);
      setCallNotice('A chamada será aberta após a triagem.');
    }
    setAlertId(id);
    try {
      const result = await syncAlert(state.active ? 'stop' : 'start', id);
      const now = Date.now();
      const startedAt = result.status === 'started' ? Date.parse(result.startedAt) : 0;
      const active = result.status === 'started';
      setState(previous => ({ ...advance(previous, active, now), incidentAt: active ? startedAt : 0 }));
      setIncident(undefined);
      setPending(undefined);
      setRetryAt(0);
      if (!active) {
        closeWaitingTab();
        setCallNotice('');
        setAutoInvite(undefined);
        setAlertId(undefined);
      }
    } catch (error) {
      if (!state.active) {
        closeWaitingTab();
        setCallNotice('');
      }
      setProblem(error instanceof Error ? error.message : 'Falha ao sincronizar a simulação.');
    } finally {
      setBusy(false);
    }
  }

  function advance(previous: typeof state, active: boolean, now: number): typeof state {
    const tick = previous.tick + 1;
    return {
      ...previous, tick, active, updatedAt: now,
      samples: monitors.map((monitor, index) => [...previous.samples[index].slice(1), reading(monitor, tick, active)]),
    };
  }

  const impacted = state.active ? monitors.filter(monitor => monitor.incident).length : 0;
  const pixApproval = state.samples[0].at(-1)!.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return <>
    <SiteHeader current="monitors" />

    <main className="content">
      <section className="heading" aria-labelledby="page-title">
        <div>
          <p className="eyebrow"><Activity size={16} /> Central de operações</p>
          <h1 id="page-title">Monitores</h1>
          <p className="subtitle">Acompanhe a saúde dos serviços de pagamentos e contas.</p>
        </div>
        <div className="heading-actions">
        <button className={state.active ? 'button secondary' : 'button primary'} onClick={toggleIncident} disabled={busy || checking}>
          {state.active ? <CheckCircle2 size={19} /> : <Siren size={19} />}
          {state.active ? 'Encerrar simulação' : 'Simular incidente'}
        </button>
        </div>
      </section>

      <dl className="summary" aria-label="Resumo dos serviços">
        <div><dt><Radio size={16} /> Monitores ativos</dt><dd>{monitors.length}</dd></div>
        <div><dt><CheckCircle2 size={16} /> Operacionais</dt><dd className="green">{monitors.length - impacted}</dd></div>
        <div><dt><Bell size={16} /> Serviços afetados</dt><dd className={impacted ? 'red' : ''}>{impacted}</dd></div>
        <div><dt><Zap size={16} /> Aprovação do PIX</dt><dd className={state.active ? 'red' : ''}>{pixApproval}<small>%</small></dd></div>
      </dl>

      <div className={state.active ? 'incident active' : 'incident'} role="status">
        {state.active ? <TriangleAlert size={21} /> : <CheckCircle2 size={21} />}
        <div>
          <strong>{state.active ? 'PIX com falha há 3 minutos (simulação)' : 'Todos os serviços operacionais'}</strong>
          <p>{state.active ? 'Falhas na confirmação de transferências afetam o gateway e a conciliação.' : 'Nenhum incidente ativo.'}</p>
        </div>
        {state.incidentAt > 0 && <time dateTime={new Date(state.incidentAt).toISOString()}>{clock.format(state.incidentAt)}</time>}
      </div>

      {(state.active || problem) && <aside className="triage" aria-live="polite">
        <strong>Triagem · últimos 15 minutos</strong>
        {incident ? <p>
          Incidente #{incident.id} salvo no Supabase · Prioridade {incident.priority}
          {incident.source === 'jev' ? ' · Jev' : ' · registro anterior'}.
        </p> : state.active ? <p>
          {pending?.reason ?? 'Consultando o histórico e comparando os eventos no Jev.'}
        </p> : null}
        {(incident?.comparisons.length || pending?.candidates.length) ? (
          <ol className="triage-events" aria-label="Ocorrências consultadas">
            {(incident?.comparisons.length ? incident.comparisons : pending?.candidates ?? []).map((event: Candidate | Comparison) => (
              <li key={`${event.source}:${event.at}:${event.title}:${event.signal}`}>
                <div><time dateTime={event.at}>{clock.format(new Date(event.at))}</time> · <b>{event.title}</b> · {event.source === 'demo' ? 'Demonstração' : 'Supabase'}</div>
                <p>{event.signal}</p>
                {'label' in event && <span className={`correlation ${event.label}`}>
                  {{ related: 'Correlacionado', unrelated: 'Descartado', uncertain: 'Inconclusivo' }[event.label]}
                  {' · '}{Math.round(event.probability * 100)}%
                </span>}
              </li>
            ))}
          </ol>
        ) : null}
        {problem && <p className="red">{problem}{state.active && !incident ? ' O painel tentará novamente.' : ''}</p>}
      </aside>}

      {(callNotice || autoInvite) && <div className="auto-call">
        <p role="status">{callNotice}</p>
        {autoInvite && <a className="button secondary compact" href={autoInvite.url} target="_blank" rel="noopener noreferrer">
          <Phone size={16} /> Abrir chamada do plantão
        </a>}
      </div>}
      {(!state.active || incident) && <CallInvite key={incident?.id ?? 'latest'} incidentId={incident?.id} />}

      <section aria-labelledby="service-title">
        <div className="section-heading">
          <h2 id="service-title">Status dos serviços</h2>
          <span className="live"><i /> Atualização a cada 2 s</span>
        </div>
        <div className="grid">
          {monitors.map((monitor, index) => {
            const Icon = monitor.icon;
            const incident = state.active ? monitor.incident : undefined;
            const status = incident?.status ?? 'normal';
            const digits = monitor.decimals ?? 0;
            const value = state.samples[index].at(-1)!.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

            return <article key={monitor.id} className={`monitor ${status} ${monitor.id === 'pix' ? 'featured' : ''}`}>
              <header className="monitor-header">
                <span className="monitor-icon"><Icon size={20} /></span>
                <div><h3>{monitor.name}</h3><p>{monitor.metric}</p></div>
                <span className="badge"><i /> {labels[status]}</span>
              </header>
              <p className="reading">{value} <small>{monitor.unit}</small></p>
              <Sparkline monitor={monitor} points={state.samples[index]} />
              <p className={incident ? 'card-note affected' : 'card-note'}>{incident?.detail ?? 'Últimas 24 leituras'}</p>
            </article>;
          })}
        </div>
      </section>

      <footer>
        <span>Métricas simuladas · incidentes registrados no Supabase</span>
        <span>{state.updatedAt ? `Última leitura às ${clock.format(state.updatedAt)}` : 'Aguardando a próxima leitura'}</span>
      </footer>
    </main>
  </>;
}
