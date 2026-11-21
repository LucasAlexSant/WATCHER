'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, CircleAlert, FileText, LocateFixed, MapPin, Maximize2, Mic, Minimize2, RotateCcw, X } from 'lucide-react';
import { api, send, sendReport } from '@/lib/browser-api';
import { normalizeCity, type Coordinates, type DeviceLocation, type Report, type VoiceMapEvent } from '@/lib/incidents';
import { EvidenceCapture } from './EvidenceCapture';
import { LocationPicker } from './LocationPicker';
import { emptyReport, ReportFields, ReportSummary } from './ReportFields';
import { VoicePanel } from './VoicePanel';

const IncidentMap = dynamic(() => import('./IncidentMap'), {
  ssr: false,
  loading: () => <div className="map-frame map-background map-loading" role="status">Carregando mapa…</div>,
});

export function Citizen() {
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [report, setReport] = useState<Report>(emptyReport);
  const [voiceReport, setVoiceReport] = useState<Report | null>(null);
  const [picked, setPicked] = useState<Coordinates | null>(null);
  const [mapFocus, setMapFocus] = useState(0);
  const [voiceMapEvent, setVoiceMapEvent] = useState<VoiceMapEvent | null>(null);
  const [municipalPoint, setMunicipalPoint] = useState<{ key: string; point: Coordinates } | null>(null);
  const [device, setDevice] = useState<DeviceLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState(false);
  const [receipt, setReceipt] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLElement>(null);
  const mapArea = useRef<HTMLElement>(null);
  const mapButton = useRef<HTMLButtonElement>(null);
  const returnToPanel = useRef(false);
  const locationRequest = useRef(0);
  const { city, uf } = report;
  const placeKey = `${uf ?? ''}:${city ?? ''}`;

  useEffect(() => {
    if (!city || mode !== 'text') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ candidates: Coordinates[] }>('/api/geocode', { ...send('POST', { city, uf }), signal: controller.signal })
        .then(({ candidates }) => {
          if (controller.signal.aborted) return;
          setMunicipalPoint(candidates.length === 1 ? { key: placeKey, point: candidates[0] } : null);
        }).catch(() => {});
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [city, mode, placeKey, uf]);

  const currentReport = mode === 'voice' ? voiceReport : report;
  const fallback = mode === 'voice' ? voiceReport?.coordinates ?? null : municipalPoint?.key === placeKey ? municipalPoint.point : null;
  const deviceDiffers = Boolean(device && (
    (device.city && currentReport?.city && normalizeCity(device.city) !== normalizeCity(currentReport.city)) ||
    (device.uf && currentReport?.uf && device.uf !== currentReport.uf)
  ));
  const appliedMapEvent = mode === 'voice' && device && voiceMapEvent &&
    device.coordinates.latitude === voiceMapEvent.point.latitude && device.coordinates.longitude === voiceMapEvent.point.longitude
    ? voiceMapEvent : null;
  const voicePoint = appliedMapEvent?.kind === 'confirmed' ? appliedMapEvent.point : null;
  const discarded = appliedMapEvent?.kind === 'discarded';
  const selectedPoint = discarded || (deviceDiffers && device?.confirmedForIncident) ? null : voicePoint ?? picked;
  const point = selectedPoint ?? fallback;
  const draftPoint = mode === 'voice' ? voiceReport?.coordinates : null;
  const draftHasDevicePoint = device && draftPoint?.precision === 'confirmed' &&
    draftPoint.latitude === device.coordinates.latitude && draftPoint.longitude === device.coordinates.longitude;
  const pendingDevice = device && !device.confirmedForIncident && !draftHasDevicePoint && !voicePoint && !discarded ? device : null;
  const mapPoint = appliedMapEvent?.kind === 'shown' ? appliedMapEvent.point : pendingDevice?.coordinates ?? point;
  const agentDevice = deviceDiffers ? null : device;
  const suggestedAddress = !discarded && [device?.street, device?.houseNumber, device?.neighborhood, device?.city, device?.uf]
    .filter(Boolean).join(', ');
  const textReport = { ...report, coordinates: point };
  const nextMode = (value: 'voice' | 'text') => { setMode(value); setError(''); };

  function clearDevice() {
    locationRequest.current++;
    setDevice(null);
    setVoiceMapEvent(null);
    setLocating(false);
    setLocationMessage('');
  }

  async function lookupDeviceArea(location: DeviceLocation): Promise<DeviceLocation> {
    try {
      const area = await api<Pick<DeviceLocation, 'city' | 'uf' | 'street' | 'neighborhood' | 'houseNumber'>>('/api/geocode/reverse', {
        ...send('POST', location), signal: AbortSignal.timeout(10_000),
      });
      return { ...location, ...area };
    } catch {
      return location;
    }
  }

  function updateLocation(location: Coordinates | null) {
    clearDevice();
    const isFallback = location?.latitude === fallback?.latitude &&
      location?.longitude === fallback?.longitude && location?.precision === fallback?.precision;
    setPicked(isFallback ? null : location);
    if (location) setMapFocus((previous) => previous + 1);
    if (!location || isFallback || location.precision !== 'confirmed') return;
    const attempt = locationRequest.current;
    const marked: DeviceLocation = { coordinates: location, accuracy: 0, city: null, uf: null, confirmedForIncident: true };
    setDevice(marked);
    void lookupDeviceArea(marked).then((resolved) => {
      if (attempt === locationRequest.current) setDevice(resolved);
    });
  }

  function requestDeviceLocation() {
    if (!navigator.geolocation) {
      setLocationMessage('O dispositivo não disponibilizou a localização. Você pode marcar no mapa.');
      return;
    }
    const attempt = ++locationRequest.current;
    if (device?.confirmedForIncident) setPicked(null);
    setDevice(null);
    setVoiceMapEvent(null);
    setLocating(true);
    setLocationMessage('Aguardando permissão do dispositivo…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (attempt !== locationRequest.current) return;
      const coordinates: Coordinates = {
        latitude: coords.latitude, longitude: coords.longitude,
        precision: 'approximate',
      };
      const location = { coordinates, accuracy: coords.accuracy, city: null, uf: null };
      setDevice(location);
      setMapFocus((previous) => previous + 1);
      setLocationMessage(`Margem de erro estimada pelo GPS: ${Math.ceil(location.accuracy)} m. Confira o ponto no mapa.`);
      setLocating(false);
      const resolved = await lookupDeviceArea(location);
      if (attempt !== locationRequest.current) return;
      setDevice((previous) => previous?.confirmedForIncident
        ? { ...resolved, coordinates: previous.coordinates, confirmedForIncident: true } : resolved);
    }, (failure) => {
      if (attempt !== locationRequest.current) return;
      setLocating(false);
      setLocationMessage(failure.code === 1 ? 'Permissão de localização não concedida. Você pode marcar no mapa.'
        : 'O dispositivo não encontrou a localização. Você pode marcar no mapa.');
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  }

  function confirmDeviceLocation(location: DeviceLocation) {
    const coordinates: Coordinates = { ...location.coordinates, precision: 'confirmed' };
    setDevice({ ...location, coordinates, confirmedForIncident: true });
    setPicked(coordinates);
    setMapFocus((previous) => previous + 1);
    setReport((previous) => previous.city || (previous.uf && previous.uf !== location.uf)
      ? previous : { ...previous, city: location.city, uf: location.uf });
    setLocationMessage('Ponto da ocorrência confirmado. Se já estiver falando com o agente, diga que confirmou o ponto no mapa.');
  }

  const suggestDeviceLocation = useEffectEvent(() => {
    if (locationRequest.current === 0) requestDeviceLocation();
  });

  useEffect(() => {
    let active = true;
    void navigator.permissions?.query({ name: 'geolocation' }).then(({ state }) => {
      if (active && state === 'granted') suggestDeviceLocation();
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const area = mapArea.current;
    if (!appliedMapEvent || appliedMapEvent.kind === 'discarded' || !area) return;
    const bounds = area.getBoundingClientRect();
    if (bounds.top >= window.innerHeight - 100 || bounds.bottom <= 100) {
      area.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [appliedMapEvent]);

  function chooseOnMap(fromPanel: boolean) {
    returnToPanel.current = fromPanel;
    setPicking(true);
    mapArea.current?.scrollIntoView({ block: 'nearest' });
    mapButton.current?.focus({ preventScroll: true });
  }

  function finishChoosing() {
    setPicking(false);
    if (returnToPanel.current) panel.current?.focus();
    returnToPanel.current = false;
  }

  function showReceipt(protocol: string) {
    locationRequest.current++;
    setLocating(false);
    setPicking(false);
    setReceipt(protocol);
  }

  function toggleMap() {
    setExpanded(!expanded);
    if (expanded) requestAnimationFrame(() => panel.current?.focus());
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ protocol: string }>('/api/report', sendReport({ key, confirmed: true, report: textReport }, photos));
      showReceipt(result.protocol);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Tente enviar novamente.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={`citizen-workspace${expanded ? ' citizen-map-expanded' : ''}`}>
    <section ref={panel} tabIndex={-1} id="painel-relato" hidden={expanded}
      className="panel citizen-card" aria-labelledby="report-title">
      <div className="citizen-heading">
        <p className="eyebrow"><span className="pulse-dot" /> Demonstração</p>
        <h1 id="report-title">Relatar ocorrência</h1>
        <p>Conte o que aconteceu por voz ou por texto. Use dados fictícios nesta demonstração.</p>
      </div>
      {receipt ? <div className="receipt">
        <span className="success-mark"><Check size={29} /></span><h2>Relato registrado</h2>
        <p>A central recebeu o relato para revisão.</p>
        <div className="receipt-code"><small>PROTOCOLO</small><strong>{receipt}</strong></div>
        <button type="button" className="button secondary" onClick={() => {
          setReport(emptyReport); setVoiceReport(null); setPicked(null); setPhotos([]); setError(''); clearDevice();
          setKey(''); setSummary(false); setReceipt('');
        }}><RotateCcw size={19} /> Registrar outro relato</button>
      </div> : <>
        <div className="mode-tabs" aria-label="Forma de registro">
          <button aria-pressed={mode === 'voice'} disabled={busy} onClick={() => nextMode('voice')}><Mic size={21} /> Por voz</button>
          <button aria-pressed={mode === 'text'} disabled={busy} onClick={() => nextMode('text')}><FileText size={21} /> Por texto</button>
        </div>
        <div className="report-tools">
          <button type="button" className="button secondary" disabled={busy || locating} onClick={requestDeviceLocation}>
            <LocateFixed size={19} /> {locating ? 'Localizando…' : device ? 'Atualizar localização' : 'Usar minha localização'}
          </button>
          <EvidenceCapture files={photos} onChange={setPhotos} disabled={busy} />
          {(locationMessage || deviceDiffers) && <p className="muted report-location-message" role="status">
            {deviceDiffers ? 'O município informado difere da localização do dispositivo. Confira o ponto no mapa.' : locationMessage}
          </p>}
          {suggestedAddress && !deviceDiffers && <p className="muted report-location-message">
            Local sugerido: {suggestedAddress}
          </p>}
        </div>
        {mode === 'voice' ? <VoicePanel onReceipt={showReceipt} onDraftReport={setVoiceReport} onMapEvent={setVoiceMapEvent} device={agentDevice} photos={photos}
          locationOverride={selectedPoint} onLocationChange={updateLocation}
          onShowMap={() => chooseOnMap(true)} onUseDevice={requestDeviceLocation}
          switchToText={(draft) => {
            if (draft) { setReport(draft); setSummary(false); setKey(''); }
            nextMode('text');
          }} /> : summary ? <div className="text-panel">
          <h2>Confira o resumo</h2>
          <ReportSummary report={textReport} />
          {photos.length > 0 && <p className="muted">{photos.length} {photos.length === 1 ? 'foto anexada' : 'fotos anexadas'}</p>}
          <LocationPicker location={point} fallback={fallback} report={report}
            onChange={updateLocation} onShowMap={() => chooseOnMap(true)} onUseDevice={requestDeviceLocation} />
          <div className="action-row">
            <button className="button primary" disabled={busy} onClick={submit}><Check size={20} /> {busy ? 'Enviando…' : 'Confirmar e enviar'}</button>
            <button className="button secondary" disabled={busy} onClick={() => setSummary(false)}>Editar relato</button>
          </div>
        </div> : <form className="text-panel" onSubmit={(event) => {
          event.preventDefault();
          setKey(key || crypto.randomUUID());
          setSummary(true);
        }}>
          <h2>Descreva a ocorrência</h2>
          <ReportFields value={report} onChange={setReport} />
          <button className="button primary" type="submit">Revisar relato</button>
        </form>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
      <aside className="citizen-emergency" aria-label="Contatos de emergência">
        <CircleAlert size={20} />
        <div><strong>Risco imediato?</strong>
          <div className="emergency-contacts">
            <a href="tel:193"><b>193</b> Bombeiros</a>
            <a href="tel:199"><b>199</b> Defesa Civil</a>
          </div>
        </div>
      </aside>
    </section>

    <section className="citizen-map" ref={mapArea} aria-label="Mapa do relato" onKeyDown={(event) => {
      if (event.key === 'Escape' && picking) { event.stopPropagation(); finishChoosing(); }
    }}>
      <IncidentMap overlay={panel} location={mapPoint} focusRequest={appliedMapEvent?.id ?? mapFocus} national onPick={picking && !busy && !receipt ? (location) => {
        updateLocation(location);
        finishChoosing();
      } : undefined} />
      <div className="map-toolbar">
        <div className="map-toolbar-actions">
          {(!receipt && !busy) && <button ref={mapButton} type="button" className={`button map-action${picking ? ' map-action-active' : ''}`}
            onClick={() => picking ? finishChoosing() : chooseOnMap(false)}>
            {picking ? <X size={20} /> : <MapPin size={20} />}
            {picking ? 'Cancelar marcação' : picked ? 'Ajustar local' : 'Marcar local'}
          </button>}
          <button type="button" className="button map-action" aria-controls="painel-relato"
            aria-expanded={!expanded} onClick={toggleMap}>
            {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            {expanded ? 'Voltar ao relato' : 'Expandir mapa'}
          </button>
        </div>
        {picking ? <p className="map-location-hint" role="status">Toque no mapa para marcar onde aconteceu.</p>
          : !receipt && pendingDevice ? <div className="map-location-hint map-location-selected">
            <span role="status">{appliedMapEvent?.kind === 'shown' ? 'A Agora mostrou sua localização no mapa.' : 'A ocorrência aconteceu exatamente neste ponto?'}</span>
            {!deviceDiffers && <button type="button" disabled={busy} onClick={() => confirmDeviceLocation(pendingDevice)}>Confirmar este ponto</button>}
            <button type="button" disabled={busy} onClick={() => chooseOnMap(false)}>Marcar outro ponto</button>
            <button type="button" disabled={busy} onClick={clearDevice}>Dispensar GPS</button>
          </div> : selectedPoint && <div className="map-location-hint map-location-selected">
            <span role="status"><Check size={18} /> {voicePoint ? 'Ponto confirmado por voz' : selectedPoint.precision === 'confirmed' ? 'Ponto confirmado no mapa' : 'Local aproximado selecionado'}</span>
            {!receipt && !busy && <button type="button" onClick={() => updateLocation(null)}>Remover</button>}
          </div>}
      </div>
      {!expanded && !picking && <button type="button" className="button primary map-jump-to-report"
        onClick={() => panel.current?.focus()}>
        <FileText size={19} /> Ir para o relato
      </button>}
    </section>
  </div>;
}
