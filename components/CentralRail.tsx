'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight, Construction, Home, MapPin, Mic, Search, Waves, X, Zap } from 'lucide-react';
import { categories, protocol, states, verificationLabels, type Incident, type PhotoEvidence } from '@/lib/incidents';

const icons = { flood: Waves, road: Construction, power: Zap, shelter: Home, infrastructure: Construction, other: MapPin };

export type CasePreview = { incident: Incident; photos: PhotoEvidence[] };

export function CentralRail({ cases, current, detail, index, pages, page, select, state, setState, verification, setVerification, query, setQuery,
  review, closeCase, voiceOpen, toggleVoice, voiceToggle, mobileOpen, toggleMobile, ready, panel }: {
  cases: Incident[];
  current: Incident | null;
  detail: CasePreview | null;
  index: number;
  pages: number;
  page: (index: number) => void;
  select: (id: string) => void;
  state: string;
  setState: (state: string) => void;
  verification: string;
  setVerification: (filter: string) => void;
  query: string;
  setQuery: (query: string) => void;
  review: (id: string) => void;
  closeCase: () => void;
  voiceOpen: boolean;
  toggleVoice: () => void;
  voiceToggle: React.RefObject<HTMLButtonElement | null>;
  mobileOpen: boolean;
  toggleMobile: () => void;
  ready: boolean;
  panel: React.RefObject<HTMLElement | null>;
}) {
  const evidence = detail?.photos[0];
  const evidenceUrl = current && evidence ? `/api/incidents/${current.id}/photos/${evidence.id}` : null;

  return <aside ref={panel} className={`central-rail${mobileOpen ? ' central-rail-open' : ''}`} aria-label="Painel de ocorrências">
    <div className="central-rail-content" id="central-ocorrencias">
      <header className="central-rail-header">
        <div className="central-rail-title">
          <h1>Ocorrências</h1>
          <button type="button" className="central-icon central-mobile-only" aria-label="Fechar ocorrências" onClick={toggleMobile}>
            <X size={17} />
          </button>
        </div>
        <label className="central-region">
          <MapPin size={15} aria-hidden="true" />
          <select aria-label="Filtrar por UF" value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">Brasil</option>
            {Object.entries(states).map(([uf, label]) => <option value={uf} key={uf}>{label}</option>)}
          </select>
        </label>
        <div className="central-search-row">
          <label className="central-search">
            <Search size={15} aria-hidden="true" />
            <input aria-label="Buscar relatos" placeholder="Buscar relatos" value={query}
              onChange={(event) => setQuery(event.target.value)} />
          </label>
          <select aria-label="Filtrar por verificação" value={verification} onChange={(event) => setVerification(event.target.value)}>
            <option value="">Status</option>
            {Object.entries(verificationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>
      </header>

      <div className="central-cases">
        {!cases.length && <p className="central-empty">{ready ? 'Nenhuma ocorrência neste recorte.' : 'Carregando ocorrências…'}</p>}
        {cases.map((item) => {
          const Icon = icons[item.category];
          return <button key={item.id} type="button" className="central-case" aria-pressed={current?.id === item.id}
            onClick={() => select(item.id)}>
            <Icon size={18} aria-hidden="true" />
            <span><strong>{categories[item.category]}</strong>
              <span>{[item.city, item.uf].filter(Boolean).join(' · ') || 'Município não informado'}</span></span>
            <ChevronRight size={15} aria-hidden="true" />
          </button>;
        })}
      </div>
      {pages > 1 && <nav className="central-pager" aria-label="Paginação de ocorrências">
        <button type="button" className="central-icon" disabled={index < 1} onClick={() => page(index - 1)}
          aria-label="Página anterior"><ChevronLeft size={16} /></button>
        <span aria-live="polite">{index + 1} / {pages}</span>
        <button type="button" className="central-icon" disabled={index + 1 >= pages} onClick={() => page(index + 1)}
          aria-label="Próxima página"><ChevronRight size={16} /></button>
      </nav>}

      {current && <section className="central-case-preview" aria-label="Ocorrência selecionada">
        <div className="central-preview-heading">
          <div><h2>{categories[current.category]}{current.city ? ` em ${current.city}` : ''}</h2>
            <p>{protocol(current.id)} · {verificationLabels[current.verification]}</p></div>
          <button type="button" className="central-icon" aria-label="Fechar detalhes" onClick={closeCase}><X size={17} /></button>
        </div>
        {evidenceUrl ? <a className="central-preview-photo" href={evidenceUrl} target="_blank" rel="noreferrer"
          aria-label="Abrir foto da ocorrência em outra aba">
          <Image src={evidenceUrl} alt="Foto de evidência da ocorrência" width={480} height={270} unoptimized />
        </a> : <p className="central-preview-description">{current.description}</p>}
        <button type="button" className="central-review" onClick={() => review(current.id)}>
          Revisar ocorrência <ChevronRight size={15} />
        </button>
      </section>}
    </div>

    <div className="central-rail-footer">
      <button ref={voiceToggle} type="button" className="button primary central-consult" aria-controls="central-voz" aria-expanded={voiceOpen} onClick={toggleVoice}>
        <Mic size={17} /> {voiceOpen ? 'Fechar consulta' : 'Consultar com a Agora'}
      </button>
    </div>
  </aside>;
}
