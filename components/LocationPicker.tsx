'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { LocateFixed, MapPin } from 'lucide-react';
import type { Coordinates, Report } from '@/lib/incidents';
import { api, send } from '@/lib/browser-api';

const IncidentMap = dynamic(() => import('./IncidentMap'), { ssr: false });

export function LocationPicker({ location, onChange, fallback, report, onShowMap, onUseDevice }: {
  location: Coordinates | null;
  onChange: (point: Coordinates | null) => void;
  fallback: Coordinates | null;
  report: Pick<Report, 'city' | 'address' | 'uf'>;
  onShowMap?: () => void;
  onUseDevice?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<Array<Coordinates & { label: string }>>([]);
  const [searching, setSearching] = useState(false);

  async function search() {
    setSearching(true);
    setMessage('');
    setCandidates([]);
    try {
      const found = await api<{ candidates: Array<Coordinates & { label: string }> }>('/api/geocode',
        send('POST', { city: report.city, address: report.address, uf: report.uf }));
      setCandidates(found.candidates);
      if (!found.candidates.length) setMessage('Nenhum endereço encontrado. Você pode marcar o ponto no mapa.');
    } catch (cause) {
      setMessage((cause as Error).message);
    } finally {
      setSearching(false);
    }
  }
  return <div className="location-picker">
    <div className="action-row">
      {onShowMap && <button type="button" className="button secondary" onClick={onShowMap}><MapPin size={18} /> {location ? 'Ajustar ponto no mapa' : 'Marcar no mapa'}</button>}
      <button type="button" className="button secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
        {!onShowMap && <MapPin size={17} />} {onShowMap ? 'Buscar local' : open ? 'Fechar mapa' : 'Ajustar ponto no mapa'}
      </button>
      {location && (location.latitude !== fallback?.latitude || location.longitude !== fallback?.longitude || location.precision !== fallback?.precision) &&
        <button type="button" className="button link-button" onClick={() => onChange(fallback)}>Remover ponto escolhido</button>}
    </div>
    {open && <div className="location-options">
      {!onShowMap && <>
        <p className="muted">Toque no mapa para marcar onde aconteceu.</p>
        <IncidentMap location={location} onPick={onChange} />
      </>}
      <div className="action-row">
      {report.city && report.address && <button type="button" className="button secondary" disabled={searching}
        onClick={search}>{searching ? 'Buscando…' : 'Buscar endereço'}</button>}
      <button type="button" className="button secondary" onClick={() => {
        if (onUseDevice) return onUseDevice();
        if (!navigator.geolocation) return setMessage('Localização do dispositivo indisponível.');
        setMessage('Aguardando localização…');
        navigator.geolocation.getCurrentPosition(({ coords }) => {
          onChange({ latitude: coords.latitude, longitude: coords.longitude, precision: 'confirmed' });
          setMessage('Localização obtida. Confira se corresponde ao local do relato.');
        }, () => setMessage('Localização indisponível. Você pode marcar o ponto no mapa.'), { timeout: 8000 });
      }}><LocateFixed size={17} /> Usar minha localização</button>
      </div>
      {candidates.length > 0 && <div className="location-candidates">
        <p className="muted">Selecione o resultado que corresponde ao relato.</p>
        {candidates.map(({ label, ...point }) => <button type="button" className="button secondary" key={label} onClick={() => {
          onChange(point); setCandidates([]);
        }}>{label}</button>)}
      </div>}
      {message && <p className="muted" role="status">{message}</p>}
    </div>}
  </div>;
}
