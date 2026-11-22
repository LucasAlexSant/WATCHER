'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { roomContext } from '../api/warroom/store';
import type { ChangeCandidate, ChangeReview } from '../api/warroom/change-types';
import { rollbackLabels } from '../api/warroom/rollback';

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

export function WarRoomPanel({ room, saveStatus, recapStatus, onSummarize, summaryBusy }: {
  room?: RoomContext; saveStatus: string; recapStatus: string; onSummarize?: () => void; summaryBusy: boolean;
}) {
  const [minimized, setMinimized] = useState(false);
  if (!room) return null;
  return <section className="room-context" aria-labelledby="room-heading">
    <header>
      <h2 id="room-heading">Estado do war room</h2>
      <div className="invite-actions">
      {onSummarize && !minimized && <button className="button secondary compact" disabled={summaryBusy} onClick={onSummarize}>
        {summaryBusy ? 'Atualizando…' : 'Atualizar resumo'}
      </button>}
      <button className="button secondary compact" aria-expanded={!minimized} aria-controls="room-current-state" onClick={() => setMinimized(value => !value)}>
        {minimized ? <ChevronDown size={16} /> : <ChevronUp size={16} />} {minimized ? 'Expandir' : 'Minimizar'}
      </button>
      </div>
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
          {room.rollback && <div className="room-checkpoint">
            <p><time dateTime={room.rollback.reportedAt}>{roomTime(room.rollback.reportedAt)}</time> · Relato do plantão</p>
            <p><b>{rollbackLabels[room.rollback.stage]}</b>{room.rollback.changeId && ` · ${room.rollback.changeId}`}</p>
          </div>}
          {room.checkpoint ? <div className="room-checkpoint">
            <p><time dateTime={room.checkpoint.at}>{roomTime(room.checkpoint.at)}</time> · {room.checkpoint.provider === 'neuralake' ? 'Consolidado por NeuraLake' : 'Resumo do plantão'}</p>
            <p>{room.checkpoint.summary}</p>
            {room.checkpoint.consolidated && <div className="room-consolidated">
              <p><b>Situação</b> {room.checkpoint.consolidated.status}</p>
              {room.checkpoint.consolidated.impact && <p><b>Impacto</b> {room.checkpoint.consolidated.impact}</p>}
              {!!room.checkpoint.consolidated.findings?.length && <>
                <h4>O que o plantão identificou</h4><ul>{room.checkpoint.consolidated.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>
              </>}
              {!!room.checkpoint.consolidated.completedActions?.length && <>
                <h4>Ações relatadas como concluídas</h4><ul>{room.checkpoint.consolidated.completedActions.map((action, index) => <li key={index}>{action}</li>)}</ul>
              </>}
              {!!room.checkpoint.consolidated.decisions.length && <>
                <h4>Decisões</h4><ul>{room.checkpoint.consolidated.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul>
              </>}
              {!!room.checkpoint.consolidated.actions.length && <>
                <h4>Próximos passos</h4><ul>{room.checkpoint.consolidated.actions.map((action, index) => <li key={index}>
                  {action.task}{action.owner && ` · ${action.owner}`}{action.due && ` · ${action.due}`}
                </li>)}</ul>
              </>}
              {!!room.checkpoint.consolidated.pending.length && <>
                <h4>Pendências</h4><ul>{room.checkpoint.consolidated.pending.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </>}
            </div>}
            {room.checkpoint.decision && <p><b>Decisão</b> {room.checkpoint.decision}</p>}
            {room.checkpoint.nextStep && <p><b>Planejamento</b> {room.checkpoint.nextStep}</p>}
            {room.checkpoint.owner && <p><b>Responsável</b> {room.checkpoint.owner}</p>}
          </div> : <p className="room-detail">Aguardando o primeiro resumo consolidado do plantão.</p>}
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
