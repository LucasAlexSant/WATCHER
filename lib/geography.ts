import localityData from '../geo-data/municipalities.json';
import { normalizeCity, regions, states, type Coordinates, type UF } from './incidents';
import type { MapMove } from './central-actions';

export type Municipality = { id: string; name: string; uf: UF; latitude: number | null; longitude: number | null };

const catalog = (localityData as Array<[string, string, UF, number | null, number | null]>)
  .map(([id, name, uf, latitude, longitude]): Municipality => ({ id, name, uf, latitude, longitude }));
const byName = new Map<string, Municipality[]>();
const byId = new Map(catalog.map((place) => [place.id, place]));
for (const city of catalog) {
  const name = normalizeCity(city.name);
  const group = byName.get(name) ?? [];
  group.push(city);
  byName.set(name, group);
}

export function stateCode(value: string): UF | null {
  const input = normalizeCity(value);
  return (Object.entries(states).find(([uf, name]) => uf.toLowerCase() === input || normalizeCity(name) === input)?.[0] as UF | undefined) ?? null;
}

export function matchingCities(city: string, uf?: UF | null) {
  const group = byName.get(normalizeCity(city)) ?? [];
  return uf ? group.filter((place) => place.uf === uf) : group;
}

export function municipality(city: string | null, uf?: UF | null) {
  if (!city) return null;
  const matches = matchingCities(city, uf);
  return matches.length === 1 ? matches[0] : null;
}

export function municipalityPoint(city: Municipality | null): Coordinates | null {
  if (city?.latitude == null || city.longitude == null) return null;
  return { latitude: city.latitude, longitude: city.longitude, precision: 'approximate' };
}

export function municipalityById(id: string) {
  return byId.get(id) ?? null;
}

export type InsightArea = { label: string; states: readonly UF[]; city: string | null };

export function insightArea(city: string, area: string): InsightArea | { choices: string[] } {
  const uf = stateCode(area);
  const normalized = normalizeCity(area).replace(/^regiao\s+/, '').replace(/\s+/g, '-');
  const nationwide = !normalized || normalized === 'brasil' || normalized === 'br';
  const region = Object.keys(regions).find((name) => normalizeCity(name) === normalized);
  if (city) {
    if (!uf && !region && !nationwide) return { choices: [] };
    const matches = matchingCities(city, uf).filter((place) => !region || regions[region].includes(place.uf));
    if (matches.length !== 1) return { choices: matches.map((place) => `${place.name} (${place.uf})`) };
    return { label: `${matches[0].name} (${matches[0].uf})`, states: [matches[0].uf], city: matches[0].name };
  }
  if (uf) return { label: states[uf], states: [uf], city: null };
  if (nationwide) return { label: 'Brasil', states: [], city: null };
  return region ? { label: `Região ${region}`, states: regions[region], city: null } : { choices: [] };
}

export function areaView(area: InsightArea): MapMove | null {
  if (area.city) {
    const place = municipalityPoint(municipality(area.city, area.states[0]));
    return place ? { kind: 'center', center: [place.longitude, place.latitude], zoom: 11.3 } : null;
  }
  if (!area.states.length) return { kind: 'country' };

  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const point of catalog) {
    if (!area.states.includes(point.uf) || point.latitude == null || point.longitude == null) continue;
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }
  if (east < west) return null;
  return { kind: 'bounds', bounds: [[west - 0.35, south - 0.35], [east + 0.35, north + 0.35]] };
}
