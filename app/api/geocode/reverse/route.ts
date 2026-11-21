import { json, route } from '@/lib/http';
import { municipalityById, municipality, stateCode } from '@/lib/geography';
import { body, deviceFrom, InputError } from '@/lib/validation';
import { limit } from '@/lib/db';

const boundaries = 'https://geo.infrasa.gov.br/server/rest/services/Hosted/BR_Municipios_2024/FeatureServer/0/query';
const noMatch = { city: null, uf: null, street: null, neighborhood: null, houseNumber: null };

function addressPart(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
}

export async function POST(request: Request) {
  return route(async () => {
    const device = deviceFrom(await body(request));
    if (!device) throw new InputError('Localização inválida.');
    const { latitude, longitude } = device.coordinates;
    await limit('geo:reverse', 60, 60);
    // Use an envelope around a GPS fix so a point close to a municipal border can return both municipalities.
    const latError = device.accuracy / 110_000;
    const lonError = latError / Math.max(0.01, Math.cos(latitude * Math.PI / 180));
    const area = new URLSearchParams({
      f: 'json', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      geometryType: device.accuracy > 0 ? 'esriGeometryEnvelope' : 'esriGeometryPoint',
      geometry: (device.accuracy > 0
        ? [longitude - lonError, latitude - latError, longitude + lonError, latitude + latError]
        : [longitude, latitude]).join(','),
      outFields: 'cd_mun', returnGeometry: 'false', resultRecordCount: '2',
    });
    let place = null;
    try {
      const response = await fetch(`${boundaries}?${area}`, { signal: AbortSignal.timeout(6500), cache: 'no-store' });
      if (response.ok) {
        const { features, exceededTransferLimit } = await response.json();
        if (!exceededTransferLimit && features?.length === 1) {
          place = municipalityById(features[0].attributes?.cd_mun);
        }
      }
    } catch {
      // An unavailable boundary service leaves the municipality for the citizen to supply.
    }
    if (!place) return json(noMatch);

    const result = { ...noMatch, city: place.name, uf: place.uf };
    const key = process.env.GEOAPIFY_API_KEY;
    if (key && device.accuracy <= 40) {
      const query = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: 'json', lang: 'pt', apiKey: key });
      try {
        const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${query}`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const { results } = await response.json();
          const hit = results?.[0];
          const uf = hit?.country_code === 'br' ? stateCode(hit.state_code ?? hit.state ?? '') : null;
          const addressCity = uf && municipality(hit.city ?? hit.county ?? '', uf);
          if (addressCity && addressCity.id === place.id && typeof hit.distance === 'number' && hit.distance <= 30) {
            return json({ ...result, street: addressPart(hit.street), neighborhood: addressPart(hit.suburb ?? hit.district),
              houseNumber: hit.result_type === 'building' && device.accuracy <= 15 ? addressPart(hit.housenumber) : null });
          }
        }
      } catch {
        // A street lookup failure does not invalidate the municipality.
      }
    }
    return json(result);
  });
}
