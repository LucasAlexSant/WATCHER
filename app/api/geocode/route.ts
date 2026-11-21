import { limit } from '@/lib/db';
import { json, route } from '@/lib/http';
import { matchingCities, municipalityPoint, stateCode } from '@/lib/geography';
import { states } from '@/lib/incidents';
import { body, content, InputError } from '@/lib/validation';

export async function POST(request: Request) {
  return route(async () => {
    const input = await body(request);
    const city = content(input.city ?? '', 'Município', 0, 100);
    const address = content(input.address ?? '', 'Endereço', 0, 200);
    const uf = stateCode(content(input.uf ?? '', 'Estado', 0, 40));
    const found = matchingCities(city, uf);
    const fallback = found.flatMap((place) => {
      const approximate = municipalityPoint(place);
      return approximate ? [{ label: `Centro de ${place.name} (${place.uf}), aproximado`,
        city: place.name, uf: place.uf, ...approximate }] : [];
    });
    const key = process.env.GEOAPIFY_API_KEY;
    if (!key || !city || !address) return json({ candidates: fallback });
    await limit('geo:lookup', 60, 60);
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.search = new URLSearchParams({
      text: [address, city, uf && states[uf], 'Brasil'].filter(Boolean).join(', '), filter: 'countrycode:br',
      format: 'json', limit: '4', lang: 'pt', apiKey: key,
    }).toString();
    let data: { results?: Array<{ formatted?: string; lat?: number; lon?: number; result_type?: string }> };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error('Geocodificador indisponível');
      data = await response.json();
    } catch {
      if (fallback.length) return json({ candidates: fallback });
      throw new InputError('Busca de endereços indisponível. Selecione o ponto no mapa.', 502);
    }
    const candidates = (data.results ?? []).flatMap(({ formatted, lat, lon, result_type }) =>
      formatted && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180 &&
      (result_type === 'building' || result_type === 'amenity' || result_type === 'street')
        ? [{ label: formatted, latitude: lat, longitude: lon, precision: result_type === 'street' ? 'approximate' : 'confirmed' }]
        : [],
    );
    return json({ candidates: [...candidates, ...fallback] });
  });
}
