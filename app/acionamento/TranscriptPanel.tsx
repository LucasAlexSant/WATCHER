'use client';

import { useEffect, useRef } from 'react';
import type { TranscriptLine } from './transcript';
import { EvidenceCard } from './EvidenceCard';
import { ChangeDetails, roomTime, type RoomContext } from './WarRoomPanel';

export function TranscriptPanel({ room, lines, status, ended }: {
  room?: RoomContext;
  lines: TranscriptLine[];
  status: 'connecting' | 'ready' | 'unavailable';
  ended: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const node = scroll.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const changes = room?.changes.filter(change => room.sharedChanges.includes(change.id) || change.label === 'related') ?? [];
  return <section className="call-transcript" aria-labelledby="call-transcript-title">
    <header>
      <h2 id="call-transcript-title">Transcrição</h2>
      <span>{ended ? 'Chamada encerrada' : status === 'ready' ? 'Ao vivo' : status === 'connecting' ? 'Conectando' : 'Indisponível'}</span>
    </header>
    {room && <div className="evidence-strip" aria-label="Cards de incidentes e GMUDs">
      <EvidenceCard title={room.incident.title} caption={`Incidente #${room.incident.id} · ${room.incident.priority}`}>
        <p>Estado: {room.incident.state === 'RESOLVED' ? 'Resolvido' : 'Diagnosticado'}</p>
        {room.evidence?.pix && <p>Aprovação do PIX: {room.evidence.pix.approval_baseline_pct.toLocaleString('pt-BR')}% → {room.evidence.pix.simulated_approval_pct}%.</p>}
        <p>{room.incident.hypothesis}</p>
        <p>Os sinais associados orientam a investigação. A causa raiz ainda precisa de confirmação.</p>
      </EvidenceCard>
      {room.related.map((event, index) => <EvidenceCard key={`related:${event.at}:${index}`} title={event.title} caption="Sinal correlacionado · Demo">
        {event.at && <p><time dateTime={event.at}>{roomTime(event.at)}</time></p>}
        <p>{event.signal}</p>
        {typeof event.probability === 'number' && <p>Avaliação do Jev: {Math.round(event.probability * 100)}%.</p>}
      </EvidenceCard>)}
      {(changes.length > 0 ? changes : room.changeCandidates.slice(0, 2)).map(change => <EvidenceCard key={change.id} title={change.title}
        caption={`${change.id} · ${room.sharedChanges.includes(change.id) ? 'Compartilhado' : 'Mudança'}`}>
        <ChangeDetails change={change} />
      </EvidenceCard>)}
    </div>}
    <div className="transcript-scroll" ref={scroll} tabIndex={0} aria-label="Falas da chamada"
      onScroll={event => {
        const node = event.currentTarget;
        follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 45;
      }}>
      {lines.length === 0 && <p className="transcript-empty">
        {status === 'unavailable' ? 'O áudio da chamada pode continuar. A conexão de transcrição falhou.'
          : ended ? 'Nenhuma fala foi transcrita.' : 'Aguardando as primeiras falas.'}
      </p>}
      {lines.map(line => <article className={`transcript-line ${line.speaker}`} key={line.id}>
        <p className="transcript-author">
          <strong>{line.speaker === 'agent' ? 'Assistente Agora' : 'Você'}</strong>
          {line.state === 'live' && <span>Em andamento</span>}
          {line.state === 'interrupted' && <span>Interrompida</span>}
        </p>
        <p className="transcript-text">{line.text}</p>
      </article>)}
    </div>
  </section>;
}
