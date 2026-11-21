'use client';

import { MapPin } from 'lucide-react';
import { categories, states, type Report, type UF } from '@/lib/incidents';

export const emptyReport: Report = {
  category: 'flood', description: '', city: null, uf: null, address: null, people: null, mobility: null, coordinates: null,
};

export function ReportFields({ value, onChange }: { value: Report; onChange: (report: Report) => void }) {
  const update = (patch: Partial<Report>) => onChange({ ...value, ...patch });
  return (
    <div className="fields">
      <label>Categoria
        <select value={value.category} onChange={(e) => update({ category: e.target.value as Report['category'] })}>
          {Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label>O que aconteceu?
        <textarea required minLength={5} maxLength={1200} rows={3} value={value.description}
          placeholder="Ex.: A água entrou na garagem perto da praça do bairro."
          onChange={(e) => update({ description: e.target.value })} />
      </label>
      <div className="fields-row">
        <label>Município<input maxLength={100} value={value.city ?? ''} placeholder="Ex.: Recife"
          onChange={(e) => update({ city: e.target.value || null, coordinates: null })} /></label>
        <label>Estado<select value={value.uf ?? ''} onChange={(e) => update({ uf: (e.target.value || null) as UF | null, coordinates: null })}>
          <option value="">Selecione a UF</option>
          {Object.entries(states).map(([uf, name]) => <option key={uf} value={uf}>{uf} · {name}</option>)}
        </select></label>
      </div>
      <label>Endereço ou referência<input maxLength={200} value={value.address ?? ''} placeholder="Ex.: perto da praça"
        onChange={(e) => update({ address: e.target.value || null, coordinates: null })} /></label>
      <div className="fields-row">
        <label>Pessoas envolvidas<input type="number" min={0} max={9999} value={value.people ?? ''} placeholder="Se souber"
          onChange={(e) => update({ people: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>Ajuda de mobilidade
          <select value={value.mobility === null ? '' : String(value.mobility)}
            onChange={(e) => update({ mobility: e.target.value === '' ? null : e.target.value === 'true' })}>
            <option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function ReportSummary({ report }: { report: Report }) {
  return (
    <div className="report-summary">
      <span className="tag">{categories[report.category]}</span>
      <p>{report.description}</p>
      <dl>
        <div><dt>Município e UF</dt><dd>{[report.city, report.uf].filter(Boolean).join(' · ') || 'Não informado'}</dd></div>
        <div><dt>Endereço ou referência</dt><dd>{report.address || 'Não informado'}</dd></div>
        <div><dt>Pessoas envolvidas</dt><dd>{report.people ?? 'Não informado'}</dd></div>
        <div><dt>Ajuda de mobilidade</dt><dd>{report.mobility === null ? 'Não informado' : report.mobility ? 'Sim' : 'Não'}</dd></div>
      </dl>
      <p className="location-note"><MapPin size={16} />{
        report.coordinates?.precision === 'confirmed' ? 'Ponto confirmado'
          : report.coordinates ? 'Localização aproximada' : 'Sem ponto no mapa'
      }</p>
    </div>
  );
}
