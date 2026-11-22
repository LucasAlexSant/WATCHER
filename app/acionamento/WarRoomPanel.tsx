'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, GitCompareArrows } from 'lucide-react';
import type { roomContext } from '../api/warroom/store';
import type { ChangeCandidate, ChangeReview } from '../api/warroom/change-types';
import { EvidenceCard } from './EvidenceCard';

export type RoomContext = Awaited<ReturnType<typeof roomContext>>;

export function roomTime(at: string) {
  return new Date(at).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function ChangeDetails({ change }: { change: ChangeCandidate | ChangeReview }) {
  return <>
    <dl className="evidence-specs">
      <div><dt>Serviço</dt><dd>{change.service}</dd></div>
      <div><dt>Versão</dt><dd>{change.version}</dd></div>
      <div><dt>Horário</dt><dd>{roomTime(change.at)}</dd></div>
      <div><dt>Origem</dt><dd>{change.source === 'demo' ? 'Demonstração' : 'Supabase'}</dd></div>
    </dl>
    <p>{change.detail}</p>
    {'relatedProbability' in change && <p>Probabilidade de correlação do Jev: <b>{Math.round(change.relatedProbability * 100)}%</b>. A análise não confirma causa raiz.</p>}
  </>;
}

export function ChangesPanel({ room, status, busy, canEdit, onAction }: {
  room: RoomContext;
  status: string;
  busy: boolean;
  canEdit: boolean;
  onAction: (id?: string) => void;
}) {
  const rows: (ChangeCandidate | ChangeReview)[] = room.changes.length ? room.changes : room.changeCandidates;
  const strongest = room.changes.find(change => change.label === 'related')?.id;
  return <section className="room-context changes-panel" aria-labelledby="changes-heading">
    <header>
      <div><h2 id="changes-heading">Mudanças (GMUDs)</h2><p>Janela de 15 minutos antes do alerta. Suspeitas primeiro após a análise do Jev.</p></div>
      {canEdit && <button className="button secondary" disabled={busy} onClick={() => onAction()}>
        <GitCompareArrows size={17} /> {busy ? 'Processando…' : 'Analisar mudanças'}
      </button>}
    </header>
    {status && <p className="room-detail" role="status">{status}</p>}
    <div className="changes-scroll" tabIndex={0} aria-label="Tabela de mudanças">
      <table className="changes-table">
        <thead><tr><th scope="col">Mudança</th><th scope="col">Horário</th><th scope="col">Serviço</th><th scope="col">Correlação</th>{canEdit && <th scope="col">Card</th>}</tr></thead>
        <tbody>{rows.map(change => <tr key={change.id} className={change.id === strongest ? 'strongest' : undefined}>
          <td><EvidenceCard title={change.title} caption={`${change.id} · ${change.source === 'demo' ? 'Demo' : 'Supabase'}`}><ChangeDetails change={change} /></EvidenceCard></td>
          <td><time dateTime={change.at}>{roomTime(change.at)}</time></td>
          <td>{change.service}</td>
          <td>{'label' in change ? <span className={`change-label ${change.label}`}>
            {{ related: 'Suspeita', unrelated: 'Descartada', uncertain: 'Inconclusiva' }[change.label]} · {Math.round(change.probability * 100)}%
          </span> : 'Aguardando análise'}</td>
          {canEdit && <td>{room.sharedChanges.includes(change.id) ? 'Compartilhado' :
            <button className="button secondary compact" disabled={busy || !room.changes.length} onClick={() => onAction(change.id)}>Compartilhar</button>}</td>}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function WarRoomPanel({ room, saveStatus, recapStatus }: { room?: RoomContext; saveStatus: string; recapStatus: string }) {
  const [minimized, setMinimized] = useState(false);
  if (!room) return null;
  return <section className="room-context" aria-labelledby="room-heading">
    <header>
      <h2 id="room-heading">Estado do war room</h2>
      <button className="button secondary compact" aria-expanded={!minimized} aria-controls="room-current-state" onClick={() => setMinimized(value => !value)}>
        {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />} {minimized ? 'Expandir' : 'Minimizar'}
      </button>
    </header>
    {minimized && <p className="room-detail">{room.checkpoint ? `Último resumo às ${roomTime(room.checkpoint.at)}` : 'Ainda sem resumo salvo'}</p>}
    <div id="room-current-state" hidden={minimized}>
      {(saveStatus || recapStatus) && <p className="room-detail room-saving" role="status">{recapStatus || saveStatus}</p>}
      <div className="room-grid">
        <div>
          <h3>Linha do tempo</h3>
          <ol className="room-timeline">
            {room.timeline.map((event, index) => <li key={`${event.at}:${index}`}>
              {event.at && <time dateTime={event.at}>{roomTime(event.at)}</time>}
              <strong>{event.title}</strong>
              <p>{event.type} · {event.detail}</p>
            </li>)}
          </ol>
          {room.historyOnly.length > 0 && <p className="room-detail">
            {room.historyOnly.length} registro(s) histórico(s) têm apenas metadados. A ligação técnica segue sem confirmação.
          </p>}
        </div>
        <div>
          <h3>Último contexto salvo</h3>
          {room.checkpoint ? <div className="room-checkpoint">
            <p><time dateTime={room.checkpoint.at}>{roomTime(room.checkpoint.at)}</time> · {room.checkpoint.cadence === 'periodic' ? 'Resumo periódico' : 'Resumo do plantão'}</p>
            <p>{room.checkpoint.summary}</p>
            {room.checkpoint.decision && <p><b>Decisão</b> {room.checkpoint.decision}</p>}
            {room.checkpoint.nextStep && <p><b>Planejamento</b> {room.checkpoint.nextStep}</p>}
            {room.checkpoint.owner && <p><b>Responsável</b> {room.checkpoint.owner}</p>}
          </div> : <p className="room-detail">Aguardando o primeiro resumo. O agente faz uma atualização a cada dois minutos de chamada operacional.</p>}
          {room.checkpoints.length > 1 && <details className="room-previous">
            <summary>Resumos anteriores</summary>
            <ol className="room-timeline">{room.checkpoints.slice(1).map(item => <li key={item.id}>
              <time dateTime={item.at}>{roomTime(item.at)}</time><span>{item.summary}</span>
              {item.nextStep && <p><b>Planejamento</b> {item.nextStep}</p>}
            </li>)}</ol>
          </details>}
          {room.reports.length > 0 && <ul className="room-timeline">
            {room.reports.map((report, index) => <li key={`${report.at}:${index}`}>
              <time dateTime={report.at}>{roomTime(report.at)}</time><strong>Relato do plantão</strong>
              <p>{report.text}</p>
            </li>)}
          </ul>}
        </div>
      </div>
    </div>
  </section>;
}
