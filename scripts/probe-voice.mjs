// Runs one billed Agora session. Set the probe URL and project credentials before use.
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { AgoraClient, Area, generateConvoAIToken } from 'agora-agents';

const base = process.env.SOS_PROBE_URL ?? 'http://127.0.0.1:3000';
const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
assert.ok(appId && appCertificate, 'Configure as credenciais Agora para o teste.');

async function api(path, body, owner) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (owner) headers.Authorization = `Bearer ${owner}`;
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error ?? 'falha no teste'}`);
  return data;
}

const coordinates = { latitude: -29.9187, longitude: -51.1843, precision: 'approximate' };
const session = await api('/api/voice/session', { code: process.env.SOS_VOICE_CODE,
  device: { coordinates, accuracy: 25, city: 'Canoas', uf: 'RS' } });
const path = `/api/voice/session/${session.id}`;
try {
  const { agentId } = await api(path, { action: 'start' }, session.owner);
  assert.ok(agentId, 'A Agora não retornou o identificador do agente.');
  console.log('Sessão Agora iniciada.');
  const client = new AgoraClient({ area: Area.US, appId, appCertificate });
  const authorization = generateConvoAIToken({ appId, appCertificate, channelName: session.channel, uid: 123456, tokenExpire: 60 });
  const say = (text) => client.agentManagement.agentThink({
    appid: appId, agentId,
    text,
    on_listening_action: 'inject', on_thinking_action: 'interrupt', on_speaking_action: 'interrupt',
  }, {
    headers: { Authorization: `agora token=${authorization}` }, timeoutInSeconds: 8, maxRetries: 0,
  });
  await wait(3500);
  await say('A água da enchente entrou aqui na garagem.');
  await wait(6500);
  await say('Sim, foi exatamente no ponto que você mostrou no mapa.');
  await wait(6500);
  await say('Somos duas pessoas e ninguém precisa de ajuda para se deslocar. Pode preparar o resumo.');
  const deadline = Date.now() + 25_000;
  let snapshot;
  do {
    snapshot = await api(path, undefined, session.owner);
    if (snapshot.draft?.report.coordinates?.precision === 'confirmed' && snapshot.draft.report.people === 2) break;
    await wait(600);
  } while (Date.now() < deadline);
  assert.ok(snapshot.draft, 'A ferramenta HTTPS de resumo não recebeu um rascunho.');
  assert.equal(snapshot.receipt, null);
  assert.equal(snapshot.draft.report.category, 'flood');
  assert.equal(snapshot.draft.report.city, 'Canoas');
  assert.equal(snapshot.draft.report.people, 2);
  assert.equal(snapshot.draft.report.mobility, false);
  assert.deepEqual(snapshot.draft.report.coordinates, { ...coordinates, precision: 'confirmed' });
  const confirmed = await api(path, { action: 'confirm', confirmed: true, revision: snapshot.draft.revision }, session.owner);
  assert.match(confirmed.protocol, /^SOS-[A-F0-9]{10}$/);
  const repeated = await api(path, { action: 'confirm', confirmed: true, revision: snapshot.draft.revision }, session.owner);
  assert.equal(repeated.protocol, confirmed.protocol);
  const login = await fetch(`${base}/api/operator/session`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: process.env.SOS_OPERATOR_CODE || 'sos-local' }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(login.ok, `Login da Central retornou HTTP ${login.status}.`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'A Central não retornou cookie de sessão.');
  const incidentsResponse = await fetch(`${base}/api/incidents`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
  assert.ok(incidentsResponse.ok, 'Falha ao consultar ocorrências na Central.');
  const { incidents } = await incidentsResponse.json();
  const incident = incidents.find(({ id }) => `SOS-${id.replaceAll('-', '').slice(-10).toUpperCase()}` === confirmed.protocol);
  assert.deepEqual(incident?.coordinates, { ...coordinates, precision: 'confirmed' });
  await wait(1200);
  console.log(`Ponto fictício confirmado no rascunho e no registro ${confirmed.protocol} da Central. Reenvio idempotente.`);
} finally {
  const response = await fetch(`${base}${path}/stop`, { method: 'POST', signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${session.owner}` } });
  if (!response.ok) throw new Error(`Falha ao encerrar a sessão: HTTP ${response.status}`);
}
