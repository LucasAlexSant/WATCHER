import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeTool, capability, hash, localCode, openOperator, toolToken } from '../lib/security';
import { protocol, type DeviceLocation } from '../lib/incidents';
import { changeDevice, changeVoice, confirmVoice, createText, decideVoiceLocation, incidentDetail, incidentPhoto, limit, listIncidents, prepareVoice, publicSummary,
  requireToolSession, requireVoice, reviewIncident, stageDraft, voiceReceipt } from '../lib/db';
import { deviceFrom, reportFrom, reviewFrom } from '../lib/validation';
import { regionalInsights } from '../lib/insights';
import { municipality, municipalityById } from '../lib/geography';
import { reportSubmission } from '../lib/report-submission';
import { POST as agentTool } from '../app/api/agent/tools/[tool]/route';
import { GET as voiceSession } from '../app/api/voice/session/[id]/route';
import type { CentralEvent } from '../lib/central-actions';

async function verify() {
  delete process.env.DATABASE_URL;
  delete process.env.PUBLIC_URL;
  process.env.SOS_OPERATOR_CODE = localCode;
  process.env.SOS_DATA_DIR = 'memory://';
  process.env.SOS_SEED = '1';
  process.env.SOS_SESSION_SECRET = randomUUID();

  const initial = await listIncidents();
  assert.equal(initial.length, 30);
  assert.equal(new Set(initial.map(({ id }) => protocol(id))).size, initial.length);

  const id = randomUUID();
  const owner = hash(randomUUID());
  await prepareVoice(id, owner, '1234567', `sos-${id}`);
  await assert.rejects(requireVoice(id, 'wrong-owner'), { status: 404 });
  await changeVoice(id, 'prepared', 'starting');
  assert.throws(() => authorizeTool(new Request('http://localhost'), id), { status: 401 });
  authorizeTool(new Request('http://localhost', { headers: { Authorization: `Bearer ${toolToken(id)}` } }), id);
  await assert.rejects(requireToolSession(id, 'insights'), { status: 403 });
  const device: DeviceLocation = { coordinates: { latitude: -8.05, longitude: -34.9, precision: 'confirmed' }, accuracy: 28, city: 'Recife', uf: 'PE' };
  assert.equal(municipalityById('3550308')?.name, 'São Paulo');
  assert.equal(municipalityById('3518800')?.name, 'Guarulhos');
  await changeDevice(id, owner, deviceFrom(device));
  assert.equal((await requireToolSession(id, 'report')).device_location?.confirmedForIncident, false);
  await changeDevice(id, owner, deviceFrom({
    ...device, coordinates: { ...device.coordinates, precision: 'approximate' }, confirmedForIncident: true,
  }));
  const proposed = (await requireToolSession(id, 'report')).device_location;
  assert.equal(proposed?.confirmedForIncident, false);
  const shown = await decideVoiceLocation(id, proposed, 'consultar');
  assert.equal(shown?.mapEvent?.kind, 'shown');
  assert.equal(shown?.mapEvent?.point.precision, 'approximate');
  const confirmedPoint = await decideVoiceLocation(id, shown, 'confirmar');
  assert.deepEqual(confirmedPoint?.coordinates, device.coordinates);
  assert.equal(confirmedPoint?.mapEvent?.kind, 'confirmed');
  assert.notEqual(confirmedPoint?.mapEvent?.id, shown?.mapEvent?.id);
  const discardedPoint = await decideVoiceLocation(id, confirmedPoint, 'descartar');
  assert.equal(discardedPoint?.coordinates, undefined);
  assert.equal(discardedPoint?.mapEvent?.kind, 'discarded');
  await changeDevice(id, owner, deviceFrom({ ...device, confirmedForIncident: true }));
  assert.deepEqual((await requireToolSession(id, 'report')).device_location, {
    city: 'Recife', uf: 'PE', coordinates: device.coordinates, confirmedForIncident: true,
    street: null, neighborhood: null, houseNumber: null,
  });
  await changeDevice(id, owner, null);
  assert.equal((await requireToolSession(id, 'report')).device_location, null);
  const analyst = randomUUID();
  const analystOwner = capability();
  await prepareVoice(analyst, hash(analystOwner), '1234568', `sos-${analyst}`, 'insights');
  await changeVoice(analyst, 'prepared', 'starting');
  assert.equal((await requireToolSession(analyst, 'insights')).purpose, 'insights');
  await assert.rejects(requireToolSession(analyst, 'report'), { status: 403 });

  const voice = reportFrom({ category: 'flood', description: 'Água perto da praça.', city: 'Canoas',
    people: '', mobility: '', coordinates: { latitude: 0, longitude: 0, precision: 'confirmed' } }, true);
  assert.equal(voice.coordinates?.precision, 'approximate');
  assert.equal(voice.people, null);
  assert.equal(voice.mobility, null);
  await changeDevice(id, owner, deviceFrom(device));
  const draft = await stageDraft(id, voice);
  assert.deepEqual(draft.report.coordinates, voice.coordinates);
  await decideVoiceLocation(id, (await requireToolSession(id, 'report')).device_location, 'confirmar');
  const corrected = await stageDraft(id, { ...voice, people: 3 });
  assert.deepEqual(corrected.report.coordinates, device.coordinates);
  assert.equal(await voiceReceipt(id), null);
  assert.equal((await listIncidents()).length, initial.length);
  await assert.rejects(confirmVoice(id, owner, draft.revision, null), { status: 409 });
  const photoBytes = new Uint8Array(64);
  photoBytes.set([0xff, 0xd8, 0xff]);
  photoBytes.set([0xff, 0xd9], 62);
  const form = new FormData();
  form.set('payload', JSON.stringify({ action: 'confirm' }));
  form.append('photos', new File([photoBytes], 'test.jpg', { type: 'image/jpeg' }));
  const { photos } = await reportSubmission(new Request('http://localhost', { method: 'POST', body: form }));
  assert.equal(photos.length, 1);
  const results = await Promise.all([
    confirmVoice(id, owner, corrected.revision, null, photos), confirmVoice(id, owner, corrected.revision, null, photos),
  ]);
  assert.equal(results.filter(({ created }) => created).length, 1);
  assert.equal(results[0].incident.id, results[1].incident.id);
  assert.equal(await voiceReceipt(id), results[0].incident.id);
  const photoDetail = await incidentDetail(results[0].incident.id);
  assert.equal(photoDetail.photos.length, 1);
  assert.equal((await incidentPhoto(results[0].incident.id, photoDetail.photos[0].id)).replace(/\s/g, ''), photos[0]);
  await assert.rejects(incidentPhoto(randomUUID(), photoDetail.photos[0].id), { status: 404 });
  await assert.rejects(stageDraft(id, voice), { status: 409 });

  const textKey = randomUUID();
  const text = await createText({ ...voice, city: 'Dado pessoal fora do catálogo' }, textKey);
  assert.equal((await createText(voice, textKey)).created, false);
  const update = reviewFrom({ report: text.incident, verification: 'verified', operational: 'monitoring',
    version: 1, reason: 'Revisão da simulação.' });
  const reviewed = await reviewIncident(text.incident.id, update, 'Operador QA');
  assert.equal(reviewed.version, 2);
  await assert.rejects(reviewIncident(text.incident.id, update, 'Outro operador'), { status: 409 });
  const detail = await incidentDetail(reviewed.id);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.history[0].actor, 'Operador QA');
  assert.equal(detail.history[0].before?.verification, 'unverified');
  const publicData = JSON.stringify(await publicSummary());
  assert.ok(!publicData.includes('Dado pessoal'));
  assert.ok(!publicData.includes(reviewed.id));
  assert.ok(!publicData.includes('description'));
  assert.ok(!publicData.includes(photoDetail.photos[0].id));
  assert.equal(municipality('Santa Helena'), null);
  const national = await regionalInsights({ region: 'Brasil', days: 7 });
  assert.equal(national.total, initial.length + 2);
  const northeast = await regionalInsights({ region: 'Região Nordeste', days: 7 });
  assert.equal(northeast.total, 2);
  const city = await regionalInsights({ city: 'Recife', region: 'PE', days: 7 });
  assert.equal(city.total, 1);
  assert.equal(city.categories[0].label, 'Alagamento');
  assert.ok((await regionalInsights({ city: 'Santa Helena' })).choices.length > 1);

  await changeVoice(analyst, 'starting', 'active');
  const call = (session: string, tool: string, payload: Record<string, unknown>, token = toolToken(session)) => agentTool(
    new Request(`http://127.0.0.1/api/agent/tools/${tool}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, id: session }) }),
    { params: Promise.resolve({ tool }) },
  );
  const move = { action: 'aproximar', city: 'Recife', region: 'PE', callId: 'tool-test-map' };
  assert.equal((await call(id, 'move-map', move)).status, 403);
  assert.equal((await call(analyst, 'move-map', move, 'wrong-token')).status, 401);
  assert.equal((await (await call(analyst, 'move-map', move)).json()).enviado, true);
  assert.equal((await (await call(analyst, 'move-map', move)).json()).enviado, true);
  assert.equal((await (await call(analyst, 'open-incident', { protocol: 'SOS-DEADDEAD00' })).json()).enviado, false);
  assert.equal((await (await call(analyst, 'open-incident', { protocol: protocol(results[0].incident.id), callId: 'tool-test-open' })).json()).enviado, true);
  assert.equal((await (await call(analyst, 'move-map', { action: 'afastar' })).json()).enviado, true);

  const mainUrl = 'http://127.0.0.1/api/voice/session/';
  const cookie = openOperator(new NextRequest(mainUrl), new NextResponse(), localCode).headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const poll = (session: string, sessionOwner: string, cursor: string, authenticated = true) => voiceSession(
    new NextRequest(`${mainUrl}${session}?after=${cursor}`, {
      headers: { Authorization: `Bearer ${sessionOwner}`, ...(authenticated ? { Cookie: cookie } : {}) },
    }), { params: Promise.resolve({ id: session }) },
  );
  assert.equal((await poll(analyst, analystOwner, '0', false)).status, 401);
  assert.equal((await poll(analyst, capability(), '0')).status, 404);
  assert.equal((await poll(analyst, analystOwner, '-1')).status, 400);
  const events: CentralEvent[] = (await (await poll(analyst, analystOwner, '0')).json()).commands;
  assert.equal(events.length, 3);
  assert.equal(events[0].action.kind, 'map');
  assert.equal(events[0].action.move?.kind, 'center');
  assert.equal(events[1].action.kind, 'incident');
  if (events[1].action.kind === 'incident') assert.equal(events[1].action.incidentId, results[0].incident.id);
  assert.deepEqual(events[2].action.move, { kind: 'zoom', delta: -1 });
  const resume: CentralEvent[] = (await (await poll(analyst, analystOwner, events[0].cursor)).json()).commands;
  assert.deepEqual(resume, events.slice(1));
  await changeVoice(analyst, 'active', 'stopped');
  assert.equal((await call(analyst, 'move-map', move)).status, 403);
  assert.deepEqual((await (await poll(analyst, analystOwner, '0')).json()).commands, []);

  await limit('check-limit', 1, 60);
  await assert.rejects(limit('check-limit', 1, 60), { status: 429 });
  console.log('Fluxos verificados: voz, GPS, fotos privadas, consultas nacionais, comandos da Central, revisão e idempotência.');
}

verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
