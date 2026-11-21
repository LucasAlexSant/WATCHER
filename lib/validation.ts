import { categories, operationalLabels, verificationLabels, type Coordinates, type DeviceLocation, type Report } from './incidents';
import { municipality, municipalityPoint, stateCode } from './geography';

export class InputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Dados inválidos.');
  return value as Record<string, unknown>;
}

export async function body(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new InputError('Envie os dados como JSON.', 415);
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  if (!reader) throw new InputError('Dados ausentes.');
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new InputError('O relato excede o tamanho máximo.', 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    try {
      return object(JSON.parse(raw + decoder.decode()));
    } catch {
      throw new InputError('Dados inválidos.');
    }
  } finally {
    reader.releaseLock();
  }
}

export function content(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new InputError(`${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return value.trim();
}

export function option<T extends Record<string, string>>(value: unknown, choices: T): keyof T & string {
  if (typeof value !== 'string' || !Object.hasOwn(choices, value)) throw new InputError('Opção inválida.');
  return value as keyof T & string;
}

export function positiveInt(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new InputError(`${label} inválida.`);
  return value;
}

export function uuid(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) {
    throw new InputError('Identificador inválido.');
  }
  return value;
}

export function coordinatesFrom(value: unknown): Coordinates {
  const { latitude, longitude, precision } = object(value);
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      (precision !== 'confirmed' && precision !== 'approximate')) {
    throw new InputError('Localização inválida.');
  }
  return { latitude, longitude, precision };
}

export function deviceFrom(value: unknown): DeviceLocation | null {
  if (value == null) return null;
  const data = object(value);
  const coordinates = coordinatesFrom(data.coordinates);
  if (typeof data.accuracy !== 'number' || !Number.isFinite(data.accuracy) || data.accuracy < 0) {
    throw new InputError('Precisão de localização inválida.');
  }
  const uf = stateCode(content(data.uf ?? '', 'Estado', 0, 40));
  const place = municipality(content(data.city ?? '', 'Município', 0, 100), uf);
  return { coordinates, accuracy: data.accuracy, city: place?.name ?? null, uf: place?.uf ?? null,
    street: content(data.street ?? '', 'Rua', 0, 100) || null,
    neighborhood: content(data.neighborhood ?? '', 'Bairro', 0, 100) || null,
    houseNumber: content(data.houseNumber ?? '', 'Número', 0, 100) || null,
    confirmedForIncident: data.confirmedForIncident === true && coordinates.precision === 'confirmed' };
}

export function reportFrom(value: unknown, fromAgent = false): Report {
  const data = object(value);
  const city = content(data.city ?? '', 'Município', 0, 100) || null;
  const state = content(data.uf ?? '', 'Estado', 0, 40);
  const uf = stateCode(state);
  if (state && !uf && !fromAgent) throw new InputError('Selecione um estado brasileiro.');
  const place = municipality(city, uf);
  const address = content(data.address ?? '', 'Endereço', 0, 200) || null;
  const rawPeople = data.people === '' || data.people == null ? null : data.people;
  const people = fromAgent && typeof rawPeople === 'string' && /^\d{1,4}$/.test(rawPeople)
    ? Number(rawPeople)
    : rawPeople;
  if (people !== null && (typeof people !== 'number' || !Number.isInteger(people) || people < 0 || people > 9999)) {
    throw new InputError('Informe um número de pessoas entre 0 e 9999.');
  }
  const rawMobility = data.mobility === '' || data.mobility == null ? null : data.mobility;
  const mobility = fromAgent && (rawMobility === 'sim' || rawMobility === 'não')
    ? rawMobility === 'sim'
    : rawMobility;
  if (mobility !== null && typeof mobility !== 'boolean') throw new InputError('Informação de mobilidade inválida.');
  const coordinates = !fromAgent && data.coordinates != null ? coordinatesFrom(data.coordinates) : municipalityPoint(place);
  return { category: option(data.category, categories), description: content(data.description, 'Descrição', 5, 1200),
    city: place?.name ?? city, uf: place?.uf ?? uf, address, people, mobility, coordinates };
}

export function reviewFrom(data: Record<string, unknown>) {
  return {
    report: reportFrom(data.report),
    verification: option(data.verification, verificationLabels),
    operational: option(data.operational, operationalLabels),
    version: positiveInt(data.version, 'Versão'),
    reason: content(data.reason, 'Justificativa', 4, 500),
  };
}
