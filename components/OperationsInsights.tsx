'use client';

import { useState } from 'react';
import { ChartBar, ListRestart } from 'lucide-react';
import { api, send } from '@/lib/browser-api';
import { regions, states } from '@/lib/incidents';
import type { InsightResult } from '@/lib/insights';
import type { CentralAction } from '@/lib/central-actions';
import { VoicePanel } from './VoicePanel';

export function OperationsInsights({ onAction }: { onAction: (action: CentralAction) => void }) {
  const [mode, setMode] = useState<'voice' | 'filters'>('voice');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('Brasil');
  const [days, setDays] = useState(7);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function query(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      setResult(await api<InsightResult>('/api/operator/insights', send('POST', {
        city, region: city.trim() && region === 'Brasil' ? '' : region, days,
      })));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="insights-panel">
    <div className="mode-tabs" aria-label="Consulta de ocorrências">
      <button type="button" aria-pressed={mode === 'voice'} onClick={() => setMode('voice')}>Por voz</button>
      <button type="button" aria-pressed={mode === 'filters'} onClick={() => setMode('filters')}>Por filtros</button>
    </div>
    {mode === 'voice'
      ? <>
        <VoicePanel purpose="insights" onCentralAction={onAction} />
        <p className="insight-example">Experimente dizer “Mostre Recife no mapa” ou “Abra a ocorrência” seguido do protocolo.</p>
      </>
      : <form className="fields insight-form" onSubmit={query}>
        <label>Região ou estado
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="Brasil">Brasil</option>
            <optgroup label="Regiões">{Object.keys(regions).map((key) => <option key={key} value={key}>{key}</option>)}</optgroup>
            <optgroup label="Estados">{Object.entries(states).map(([uf, label]) => <option key={uf} value={uf}>{label} ({uf})</option>)}</optgroup>
          </select>
        </label>
        <label>Município, se quiser detalhar<input value={city} maxLength={100} onChange={(event) => setCity(event.target.value)}
          placeholder="Ex.: Recife" /></label>
        <label>Período<select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={1}>Últimas 24 horas</option><option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option><option value={365}>Últimos 365 dias</option>
        </select></label>
        <button className="button primary" disabled={loading}><ChartBar size={19} /> {loading ? 'Consultando…' : 'Consultar ocorrências'}</button>
      </form>}
    {mode === 'filters' && error && <p className="error" role="alert">{error}</p>}
    {mode === 'filters' && result && <section className="insight-results" aria-live="polite">
      {result.area && <><h3>{result.area}</h3><p>{result.total} {result.total === 1 ? 'relato' : 'relatos'} · {result.verified} verificados · {result.reviewing + result.unverified} pendentes</p></>}
      {result.choices.length > 0 && <ul>{result.choices.map((choice) => <li key={choice}>{choice}</li>)}</ul>}
      {result.categories.length > 0 && <ol>{result.categories.map(({ label, total }) => <li key={label}>{label}<strong>{total}</strong></li>)}</ol>}
      <p className="muted">{result.message}</p>
      {!result.area && <button type="button" className="button secondary" onClick={() => { setRegion('Brasil'); setCity(''); setResult(null); }}>
        <ListRestart size={19} /> Limpar filtros
      </button>}
    </section>}
  </div>;
}
