'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock3, Copy, Radio, Users } from 'lucide-react';
import { SiteHeader } from '../SiteHeader';
import { callRequest, reserveCallTab, type CallInvitation } from '../call-client';
import type { listWarRooms } from '../api/warroom/store';
import { rollbackLabels } from '../api/warroom/rollback';

type Room = Awaited<ReturnType<typeof listWarRooms>>[number];
type Directory = { rooms: Room[]; canShare: boolean };
type AccessLink = { url: string; expiresAt: number; externallyAccessible: boolean };
type Filter = 'active' | 'resolved' | 'all';

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

export default function WarRoomsPage() {
  const [directory, setDirectory] = useState<Directory>();
  const [filter, setFilter] = useState<Filter>('all');
  const [readError, setReadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [opening, setOpening] = useState<number>();
  const [fallback, setFallback] = useState<{ id: number; url: string }>();
  const [access, setAccess] = useState<AccessLink>();
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const token = useRef('');

  useEffect(() => {
    let mounted = true;
    let updating = false;
    token.current = window.location.hash.slice(1);
    const refresh = async () => {
      if (updating) return;
      updating = true;
      try {
        const result = await callRequest<Directory>({ action: 'listWarRooms', directoryToken: token.current });
        if (mounted) {
          setDirectory(result);
          setReadError('');
        }
      } catch (issue) {
        if (mounted) setReadError(issue instanceof Error ? issue.message : 'Falha ao carregar os war rooms.');
      } finally {
        updating = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  async function follow(room: Room) {
    const tab = reserveCallTab();
    setOpening(room.id);
    setFallback(undefined);
    setActionError('');
    try {
      const invite = await callRequest<CallInvitation>({
        action: 'invite', mode: 'briefing', incidentId: room.id, directoryToken: token.current,
      });
      if (tab && !tab.closed) tab.location.replace(invite.url);
      else setFallback({ id: room.id, url: invite.url });
    } catch (issue) {
      if (tab && !tab.closed) tab.close();
      setActionError(issue instanceof Error ? issue.message : 'Não foi possível abrir a consulta.');
    } finally {
      setOpening(undefined);
    }
  }

  async function createAccess() {
    setSharing(true);
    setActionError('');
    setCopied(false);
    try {
      setAccess(await callRequest<AccessLink>({ action: 'directoryInvite' }));
    } catch (issue) {
      setActionError(issue instanceof Error ? issue.message : 'Não foi possível gerar o link.');
    } finally {
      setSharing(false);
    }
  }

  async function copyAccess() {
    if (!access) return;
    try {
      await navigator.clipboard.writeText(access.url);
      setCopied(true);
    } catch {
      setActionError('Selecione o endereço para copiar.');
    }
  }

  const rooms = directory?.rooms ?? [];
  const active = rooms.filter(room => room.state !== 'RESOLVED');
  const resolved = rooms.filter(room => room.state === 'RESOLVED');
  const visible = filter === 'active' ? active : filter === 'resolved' ? resolved : rooms;

  return <>
    <SiteHeader current="warrooms" />
    <main className="content">
      <section className="heading" aria-labelledby="directory-title">
        <div>
          <p className="eyebrow"><Users size={16} /> Acompanhamento executivo</p>
          <h1 id="directory-title">War rooms</h1>
          <p className="subtitle">Veja o estado dos incidentes e consulte o agente do CTO.</p>
        </div>
        {directory?.canShare && <button className="button secondary" onClick={() => void createAccess()} disabled={sharing}>
          <Copy size={17} /> {sharing ? 'Gerando link…' : 'Gerar link da lista para o CTO'}
        </button>}
      </section>

      {access && <div className="invite-detail directory-share">
        <label htmlFor="directory-link">Link de consulta válido até {dateFormat.format(new Date(access.expiresAt))}</label>
        <input id="directory-link" value={access.url} readOnly onFocus={event => event.currentTarget.select()} />
        <div className="invite-actions">
          <button className="button secondary compact" onClick={() => void copyAccess()}><Copy size={16} /> {copied ? 'Copiado' : 'Copiar link'}</button>
        </div>
        {!access.externallyAccessible && <p>O endereço atual funciona nesta máquina.</p>}
      </div>}

      <div className="directory-controls">
        <div className="directory-filters" aria-label="Filtrar war rooms">
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos <b>{rooms.length}</b></button>
          <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Em andamento <b>{active.length}</b></button>
          <button type="button" aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolvidos <b>{resolved.length}</b></button>
        </div>
        {directory && !readError && <span className="live"><i /> Atualização automática</span>}
      </div>

      {readError && <p className="directory-message red" role="alert">{readError}</p>}
      {actionError && <p className="directory-message red" role="alert">{actionError}</p>}
      {!directory && !readError && <p className="directory-message" role="status">Carregando os war rooms.</p>}
      {directory && visible.length === 0 && <p className="directory-message">Nenhum war room neste filtro.</p>}
      <div className="directory-grid">
        {visible.map(room => <article className="directory-card" key={room.id}>
          <div className="directory-card-top">
            <span className="directory-ref">#{room.id} · {room.priority}</span>
            <span className={room.state === 'RESOLVED' ? 'green' : 'directory-active'}>{room.state === 'RESOLVED' ? 'Resolvido' : 'Em andamento'}</span>
          </div>
          <h2>{room.title}</h2>
          <p className="directory-summary">{room.summary ?? 'Aguardando resumo do plantão.'}</p>
          {room.status && <p className="room-detail"><b>Situação:</b> {room.status}</p>}
          {room.rollback && <p className="room-detail"><b>{rollbackLabels[room.rollback.stage]}</b>{room.rollback.changeId && ` · ${room.rollback.changeId}`}</p>}
          {room.finding && <p className="room-detail"><b>Achado do plantão:</b> {room.finding}</p>}
          {room.completedAction && <p className="room-detail"><b>Ação relatada:</b> {room.completedAction}</p>}
          {room.nextStep && <p className="room-detail"><b>Próximo passo:</b> {room.nextStep}</p>}
          <p className="directory-time"><Clock3 size={15} />
            {room.updatedAt ? 'Resumo atualizado em' : 'Aberto em'} <time dateTime={room.updatedAt ?? room.opened_at}>{dateFormat.format(new Date(room.updatedAt ?? room.opened_at))}</time>
          </p>
          {fallback?.id === room.id ? <a className="button primary" href={fallback.url} target="_blank" rel="noopener noreferrer">Abrir consulta do CTO</a>
            : <button className="button secondary" disabled={opening !== undefined} onClick={() => void follow(room)}>
              <Radio size={17} /> {opening === room.id ? 'Preparando consulta…' : 'Acompanhar com agente do CTO'}
            </button>}
        </article>)}
      </div>
    </main>
  </>;
}
