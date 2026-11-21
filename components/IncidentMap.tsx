'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Globe2 } from 'lucide-react';
import { Map, Marker, NavigationControl, setWorkerUrl, type MapMouseEvent } from 'maplibre-gl';
import { categories, type Coordinates, type Incident } from '@/lib/incidents';
import type { MapInstruction } from '@/lib/central-actions';

const center: [number, number] = [-51.30, -29.91];
const brazilBounds: [[number, number], [number, number]] = [[-74.1, -34.1], [-31.9, 5.5]];
const noIncidents: Incident[] = [];
const noMoves: MapInstruction[] = [];
const mapColors = [
  ['background', 'background-color', '#243541'],
  ['water', 'fill-color', '#133e56'],
  ['waterway', 'line-color', '#216384'],
  ['landuse_residential', 'fill-color', '#344450'],
  ['landcover_wood', 'fill-color', '#1d473c'],
  ['park', 'fill-color', '#285847'],
  ['place_city', 'text-color', '#dee8ed'],
  ['place_city_large', 'text-color', '#f0f4f6'],
  ['place_town', 'text-color', '#d0dce3'],
  ['place_suburb', 'text-color', '#b9cbd6'],
  ['water_name', 'text-color', '#a5cadb'],
] as const;

export default function IncidentMap({
  incidents = noIncidents, selected, onSelect, location, onPick, overlay, national = false, dispatch = false, moves = noMoves, focusRequest = 0,
}: {
  incidents?: Incident[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  location?: Coordinates | null;
  onPick?: (coordinates: Coordinates) => void;
  overlay?: RefObject<HTMLElement | null>;
  national?: boolean;
  dispatch?: boolean;
  moves?: MapInstruction[];
  focusRequest?: number | string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const onPickRef = useRef(onPick);
  const currentLocation = useRef(location);
  const showBrazil = useRef<(() => void) | null>(null);
  const applied = useRef(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => { currentLocation.current = location; }, [location]);
  useEffect(() => {
    const canvas = container.current;
    if (!canvas) return;
    let instance: Map;
    try {
      setWorkerUrl('/map-worker.mjs');
      instance = new Map({ container: canvas,
        style: 'https://tiles.openfreemap.org/styles/fiord',
        center: national ? [-53.1, -14.2] : center, zoom: national ? 3.5 : 9.3,
        scrollZoom: true, cooperativeGestures: false, dragRotate: false, touchPitch: false, attributionControl: { compact: true },
        locale: { 'Map.Title': 'Mapa', 'NavigationControl.ZoomIn': 'Aumentar zoom',
          'NavigationControl.ZoomOut': 'Diminuir zoom', 'AttributionControl.ToggleAttribution': 'Mostrar atribuição' } });
    } catch {
      const timer = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(timer);
    }
    map.current = instance;
    applied.current = 0;
    instance.addControl(new NavigationControl({ showCompass: false }), dispatch || overlay ? 'bottom-right' : 'top-right');
    const handleClick = ({ lngLat }: MapMouseEvent) => onPickRef.current?.({
      latitude: lngLat.lat, longitude: lngLat.wrap().lng, precision: 'confirmed',
    });
    const handleError = () => {
      if (!instance.isStyleLoaded()) setFailed(true);
    };
    const panel = overlay?.current;
    const inset = () => {
      const floating = panel && panel.offsetWidth > 0 && getComputedStyle(panel).position === 'absolute';
      return floating ? Math.max(0, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left) : 0;
    };
    const fitBrazil = (duration: number) => instance.fitBounds(brazilBounds, {
      duration, padding: { left: inset() + 20, right: 20, top: 20, bottom: 20 },
    });
    if (national) showBrazil.current = () => fitBrazil(450);
    const handleLoad = () => {
      for (const [layer, property, color] of mapColors) {
        if (instance.getLayer(layer)) instance.setPaintProperty(layer, property, color);
      }
      if (national && applied.current === 0 && !onPickRef.current && !instance.isMoving() && !currentLocation.current) {
        fitBrazil(0);
      }
      setFailed(false);
    };
    instance.on('click', handleClick);
    instance.on('error', handleError);
    instance.on('load', handleLoad);
    const resize = panel && new ResizeObserver(() => {
      instance.setPadding({ left: inset(), right: 0, top: 0, bottom: 0 });
    });
    if (resize && panel) {
      resize.observe(panel);
      resize.observe(canvas);
    }
    return () => { resize?.disconnect(); instance.remove(); map.current = null; showBrazil.current = null; };
  }, [overlay, national, dispatch]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const grouped: Record<string, Incident[]> = {};
    for (const incident of incidents) {
      const point = incident.coordinates;
      if (!point) continue;
      const key = `${point.longitude},${point.latitude}`;
      (grouped[key] ??= []).push(incident);
    }
    const markers = Object.values(grouped).map((group) => {
      const incident = group.find(({ id }) => id === selected) ?? group[0];
      const { latitude, longitude, precision } = incident.coordinates!;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `map-marker ${incident.id === selected ? 'selected-marker' : ''}`;
      button.textContent = String(group.length);
      button.title = `${group.length} relato(s) em ${incident.city ?? 'local informado'}${precision === 'approximate' ? ' (aprox.)' : ''}`;
      button.setAttribute('aria-label', `${button.title}: ${categories[incident.category]}`);
      button.onclick = (event) => {
        event.stopPropagation();
        const current = group.findIndex(({ id }) => id === selected);
        onSelect?.(group[(current + 1) % group.length].id);
      };
      return new Marker({ element: button }).setLngLat([longitude, latitude]).addTo(instance);
    });
    if (location) {
      const marker = new Marker({ color: location.precision === 'confirmed' ? '#f2b448' : '#9fb4c6' })
        .setLngLat([location.longitude, location.latitude]).addTo(instance);
      marker.getElement().setAttribute('aria-label', location.precision === 'confirmed' ? 'Ponto marcado no relato' : 'Localização aproximada do relato');
      markers.push(marker);
    }
    return () => { markers.forEach((marker) => marker.remove()); };
  }, [incidents, location, onSelect, selected]);

  const focused = location ?? (dispatch ? null : incidents.find(({ id }) => id === selected)?.coordinates);
  const longitude = focused?.longitude;
  const latitude = focused?.latitude;
  const precision = focused?.precision;
  useEffect(() => {
    const instance = map.current;
    const canvas = container.current;
    if (!instance || !canvas || longitude == null || latitude == null) return;
    const closeUp = Boolean(overlay && focusRequest);
    const zoom = precision === 'confirmed' ? (closeUp ? 16 : 13) : (closeUp ? 15 : 11);
    const panel = overlay?.current;
    const floating = panel && panel.offsetWidth > 0 && getComputedStyle(panel).position === 'absolute';
    const left = floating ? Math.max(0, panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left) : 0;
    instance.easeTo({
      center: [longitude, latitude],
      zoom: overlay ? Math.max(instance.getZoom(), zoom) : zoom,
      padding: { left, right: 0, top: 0, bottom: 0 },
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550,
    });
  }, [focusRequest, latitude, longitude, overlay, precision]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const pending = moves.filter(({ sequence }) => sequence > applied.current);
    pending.forEach(({ sequence, move }, index) => {
      // Apply all but the last move instantly so relative zoom starts at the prior target.
      const duration = index === pending.length - 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 450 : 0;
      if (move.kind === 'center') instance.easeTo({ center: move.center, zoom: move.zoom, duration });
      else if (move.kind === 'zoom') instance.easeTo({ zoom: instance.getZoom() + move.delta, duration });
      else instance.fitBounds(move.kind === 'country' ? brazilBounds : move.bounds, { padding: 28, maxZoom: 10.5, duration });
      applied.current = sequence;
    });
  }, [moves]);

  return <div className={`map-frame${overlay ? ' map-background' : ''}${onPick ? ' map-picking' : ''}${onPick && !overlay ? ' map-picker' : ''}`}>
    <div ref={container} className="map-canvas" aria-label={onPick ? 'Mapa para selecionar a localização' : national ? 'Mapa do Brasil' : 'Mapa de ocorrências'} />
    {national && !failed && <button type="button" className="map-national-home" onClick={() => showBrazil.current?.()}>
      <Globe2 size={17} /> Ver Brasil
    </button>}
    {failed && <p className="map-error" role="status">Mapa base indisponível no momento.</p>}
  </div>;
}
