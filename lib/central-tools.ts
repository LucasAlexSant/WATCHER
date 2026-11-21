import { lookupIncidentProtocol, saveCentralAction } from './db';
import { areaView, insightArea } from './geography';
import { protocol } from './incidents';
import type { MapMove } from './central-actions';
import { content, InputError } from './validation';

export async function moveCentralMap(id: string, input: Record<string, unknown>) {
  const city = content(input.city ?? '', 'Município', 0, 100);
  const region = content(input.region ?? '', 'Região', 0, 100);
  const direction = input.action ?? 'localizar';
  if (direction !== 'localizar' && direction !== 'aproximar' && direction !== 'afastar') {
    throw new InputError('Movimento de mapa desconhecido.');
  }
  const callId = content(input.callId ?? '', 'Chamada', 0, 160) || null;
  if (!city && !region && direction !== 'localizar') {
    const message = direction === 'aproximar' ? 'A Agora aproximou o mapa.' : 'A Agora afastou o mapa.';
    await saveCentralAction(id, callId, { kind: 'map', move: { kind: 'zoom', delta: direction === 'aproximar' ? 1 : -1 }, message });
    return { enviado: true };
  }
  const area = insightArea(city, region);
  if ('choices' in area) return { enviado: false, opcoes: area.choices, mensagem: 'Confirme o município e a UF, o estado ou a região.' };
  const move = areaView(area);
  if (!move) return { enviado: false, mensagem: 'O catálogo não trouxe uma posição para esse local.' };
  await saveCentralAction(id, callId, {
    kind: 'map', move, message: `A Agora mostrou ${area.label} no mapa.`,
  });
  return { enviado: true, local: area.label };
}

export async function openCentralIncident(id: string, input: Record<string, unknown>) {
  const suffix = content(input.protocol ?? '', 'Protocolo', 1, 50).toUpperCase().replace(/^SOS[\s-]*/, '').replace(/[\s-]+/g, '');
  if (!/^[0-9A-F]{4,10}$/.test(suffix)) return { enviado: false, mensagem: 'Informe o protocolo exibido na Central.' };
  const matches = await lookupIncidentProtocol(suffix);
  if (matches.length !== 1) return { enviado: false, opcoes: matches.map((row) => protocol(row.id)),
    mensagem: matches.length ? 'Informe o protocolo completo para desambiguar.' : 'Protocolo não encontrado no SOS Live.' };
  const incident = matches[0];
  const code = protocol(incident.id);
  const point = incident.coordinates;
  const move: MapMove | null = point ? {
    kind: 'center', center: [point.longitude, point.latitude], zoom: point.precision === 'confirmed' ? 14 : 11.8,
  } : null;
  await saveCentralAction(id, content(input.callId ?? '', 'Chamada', 0, 160) || null, {
    kind: 'incident', incidentId: incident.id, move, message: `A Agora abriu a ocorrência ${code}.`,
  });
  return { enviado: true, protocolo: code };
}
