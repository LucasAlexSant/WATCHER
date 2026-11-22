import { after } from 'next/server';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { CALL_SECONDS, rtcCredentials, startVoice, stopVoice, type VoiceSession } from './agora';
import { briefingContext, cleanText, database, findRoomIncident, listWarRooms, recordRoomEvent, roomContext, type RoomIncident } from '../warroom/store';
import { roomTools, type RoomMode } from '../warroom/tools';
import { analyzeChanges, shareChange } from '../warroom/changes';
import { finalizeSummary, summarizeRoom } from '../warroom/neuralake';
import { rollbackFromSpeech } from '../warroom/rollback';

export const runtime = 'nodejs';

type Invite = { incidentId: number; nonce: string; expiresAt: number; mode: RoomMode };
type Call = {
  id: string; channel: string; uid: number; incidentId: number; mode: RoomMode;
  expiresAt: number; startedAt?: number; starting?: Promise<VoiceSession>;
  briefingVersion?: string; briefingAt?: string | null; syncingBriefing?: Promise<void>;
};
const calls = new Map<string, Call>();
const inviteMinutes = 30;

type ExecutiveContext = ReturnType<typeof briefingContext>;

function briefingTimestamp(context: ExecutiveContext) {
  return [context.lastConsolidatedAt, context.rollback?.reportedAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

async function syncBriefing(call: Call, context: ExecutiveContext) {
  if (call.mode !== 'briefing' || !call.starting || call.expiresAt <= Date.now()) return;
  const version = JSON.stringify(context);
  const updatedAt = briefingTimestamp(context);
  while (call.syncingBriefing) await call.syncingBriefing.catch(() => undefined);
  if (version === call.briefingVersion ||
      (call.briefingAt && (!updatedAt || Date.parse(updatedAt) < Date.parse(call.briefingAt)))) return;
  const task = (async () => {
    const session = await call.starting!;
    if (call.expiresAt <= Date.now()) return;
    await session.updateContext(context);
    call.briefingVersion = version;
    call.briefingAt = updatedAt;
  })();
  call.syncingBriefing = task;
  try {
    await task;
  } finally {
    if (call.syncingBriefing === task) call.syncingBriefing = undefined;
  }
}

async function pushBriefings(incident: RoomIncident) {
  const listeners = [...calls.values()].filter(call => call.mode === 'briefing' &&
    call.incidentId === incident.id && call.starting && call.expiresAt > Date.now());
  if (!listeners.length) return;
  const context = briefingContext(await roomContext(incident));
  const results = await Promise.allSettled(listeners.map(call => syncBriefing(call, context)));
  if (results.some(result => result.status === 'rejected')) console.warn('Não foi possível sincronizar um briefing de voz.');
}

async function getOnCall() {
  const [entry] = await database<{ responder_id: number }[]>(
    'service_oncall?select=responder_id&service_id=eq.pix-demo&order=priority.asc,responder_id.asc&limit=1',
  );
  if (entry) {
    const [responder] = await database<{ name: string }[]>(`responders?select=name&id=eq.${entry.responder_id}&limit=1`);
    if (responder?.name) return { name: responder.name, assigned: true };
  }
  return { name: 'Plantão de Pagamentos', assigned: false };
}

function signature(encoded: string) {
  const secret = process.env.CALL_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error('Assinatura de links não configurada.');
  return createHmac('sha256', secret).update(encoded).digest();
}

function createInvite(incidentId: number, mode: RoomMode, validUntil = Infinity) {
  const invite: Invite = { incidentId, mode, nonce: randomUUID(), expiresAt: Math.min(Date.now() + inviteMinutes * 60000, validUntil) };
  const encoded = Buffer.from(JSON.stringify(invite)).toString('base64url');
  return { token: `${encoded}.${signature(encoded).toString('base64url')}`, expiresAt: invite.expiresAt };
}

function readInvite(token: unknown, graceSeconds = 0): Invite | undefined {
  if (typeof token !== 'string' || !/^[\w-]{1,250}\.[\w-]{43}$/.test(token)) return;
  const [encoded, digest] = token.split('.');
  const supplied = Buffer.from(digest, 'base64url');
  const expected = signature(encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return;
  const invite = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Invite;
  if (!Number.isSafeInteger(invite.incidentId) || typeof invite.nonce !== 'string' || !(invite.expiresAt + graceSeconds * 1000 > Date.now())) return;
  return { ...invite, mode: invite.mode === 'briefing' ? 'briefing' : 'operations' };
}

function directoryInvite() {
  const expiresAt = Date.now() + 60 * 60000;
  const encoded = Buffer.from(JSON.stringify({ expiresAt, nonce: randomUUID() })).toString('base64url');
  return { token: `${encoded}.${signature(`directory:${encoded}`).toString('base64url')}`, expiresAt };
}

function directoryExpiry(token: unknown) {
  if (typeof token !== 'string' || !/^[\w-]{1,250}\.[\w-]{43}$/.test(token)) return 0;
  const [encoded, supplied] = token.split('.');
  const digest = Buffer.from(supplied, 'base64url');
  const expected = signature(`directory:${encoded}`);
  if (digest.length !== expected.length || !timingSafeEqual(digest, expected)) return 0;
  const { expiresAt } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { expiresAt: number };
  return Number.isSafeInteger(expiresAt) && expiresAt > Date.now() ? expiresAt : 0;
}

function summary(incident: RoomIncident, mode: RoomMode, updatedAt?: string) {
  const evidence = incident.recommended_params?.evidence;
  const pix = evidence?.pix;
  const metrics = pix ? `A aprovação do Pix caiu de ${pix.approval_baseline_pct.toLocaleString('pt-BR')} para ${pix.simulated_approval_pct} por cento.` : '';
  const question = mode === 'briefing'
    ? 'Quer que eu comece pelo impacto, pelo andamento ou pelos próximos passos?'
    : 'Posso te dar um contexto rápido do que aconteceu.';
  if (mode === 'briefing') {
    const freshness = updatedAt
      ? `O último estado consolidado é das ${new Date(updatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.`
      : 'Ainda não há um resumo consolidado do plantão.';
    return { evidence, greeting: `Olá, sou o copiloto de incidentes do CTO. Esta é a simulação ${incident.id}, prioridade ${incident.priority}. ${freshness} ${question}` };
  }
  const greeting = `Oi, aqui é o war room do WATCHER. Incidente simulado ${incident.id}, prioridade ${incident.priority}. ${question}`;
  return { evidence, greeting };
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const host = request.headers.get('host');
  const local = process.env.NODE_ENV === 'development' && !!host && /^(localhost|127\.0\.0\.1):\d+$/.test(host);
  const origin = request.headers.get('origin');
  const configuredOrigin = process.env.CALL_PUBLIC_ORIGIN;
  const publicOrigin = configuredOrigin && new URL(configuredOrigin).protocol === 'https:'
    ? new URL(configuredOrigin).origin : undefined;
  if (!origin || !(local && origin === `http://${host}`) && origin !== publicOrigin) {
    return error('Origem da chamada inválida.', 403);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return error('Acionamento inválido.', 400);

  try {
    const localOperator = local && origin === `http://${host}`;
    if (body.action === 'directoryInvite') {
      if (!localOperator) return error('Somente o painel local pode compartilhar a lista.', 403);
      const { token, expiresAt } = directoryInvite();
      return Response.json({ url: `${publicOrigin ?? origin}/warrooms#${token}`, expiresAt, externallyAccessible: Boolean(publicOrigin) });
    }
    if (body.action === 'listWarRooms') {
      if (!localOperator && !directoryExpiry(body.directoryToken)) return error('Abra a lista pelo link de consulta do CTO.', 401);
      return Response.json({ rooms: await listWarRooms(), canShare: localOperator });
    }
    if (body.action === 'invite') {
      const directory = localOperator ? Infinity : directoryExpiry(body.directoryToken);
      if (!localOperator && (!directory || body.mode !== 'briefing' || !Number.isSafeInteger(body.incidentId))) {
        return error('Este link só permite consulta a um war room.', 403);
      }
      if (body.incidentId !== undefined && (!Number.isSafeInteger(body.incidentId) || body.incidentId <= 0)) return error('Incidente inválido.', 400);
      const incident = await findRoomIncident(body.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const mode = body.mode === 'briefing' ? 'briefing' : 'operations';
      const recipient = mode === 'briefing' ? { name: 'CTO · consulta', assigned: false } : await getOnCall();
      const { token, expiresAt } = createInvite(incident.id, mode, directory);
      return Response.json({ url: `${publicOrigin ?? origin}/acionamento#${token}`, recipient, expiresAt });
    }

    const invite = readInvite(body.token, body.action === 'stop' ? CALL_SECONDS : 0);
    if (!invite) return error('Link inválido ou expirado. Peça um novo acionamento.', 401);
    if (body.action === 'preview') {
      const incident = await findRoomIncident(invite.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const { evidence } = summary(incident, invite.mode);
      return Response.json({ id: incident.id, title: incident.title, priority: incident.priority, state: incident.state, pix: evidence?.pix, expiresAt: invite.expiresAt, mode: invite.mode });
    }

    if (body.action === 'context') {
      const incident = await findRoomIncident(invite.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const context = await roomContext(incident);
      const call = calls.get(invite.nonce);
      if (invite.mode === 'briefing' && call && call.id === body.callId && call.starting) {
        after(() => syncBriefing(call, briefingContext(context)).catch(() => {
          console.warn('Não foi possível atualizar o contexto do agente do CTO.');
        }));
      }
      return Response.json(invite.mode === 'briefing' ? { ...context, reports: [] } : context);
    }

    if (body.action === 'summarize') {
      if (invite.mode !== 'operations') return error('O agente do CTO tem acesso de consulta.', 403);
      const incident = await findRoomIncident(invite.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const result = await summarizeRoom(incident);
      if (result.status === 'updated') after(() => pushBriefings(incident).catch(() => undefined));
      return Response.json(result);
    }

    if (body.action === 'analyzeChanges' || body.action === 'shareChange') {
      if (invite.mode !== 'operations') return error('Link de consulta não altera o histórico.', 403);
      const incident = await findRoomIncident(invite.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      if (body.action === 'analyzeChanges') return Response.json({ changes: await analyzeChanges(incident) });
      const changeId = cleanText(body.changeId, 40);
      if (!/^(GMUD|DEPLOY)-[0-9]+$/.test(changeId)) return error('ID de mudança inválido.', 400);
      const change = await shareChange(incident, changeId);
      return change ? Response.json({ shared: true, change }) : error('Mudança não encontrada.', 404);
    }

    if (body.action === 'prepare') {
      const now = Date.now();
      for (const [key, active] of calls) if (active.expiresAt <= now) calls.delete(key);
      if (calls.has(invite.nonce)) return error('Este link já tem uma chamada em andamento.', 409);
      const id = randomUUID();
      const channel = `sos-pix-${id}`;
      const uid = randomInt(1_000_000, 2_000_000_000);
      const credentials = rtcCredentials(channel, uid);
      calls.set(invite.nonce, { id, channel, uid, incidentId: invite.incidentId, mode: invite.mode, expiresAt: now + 45000 });
      return Response.json({ callId: id, ...credentials });
    }

    const call = calls.get(invite.nonce);
    if (!call && body.action === 'stop') return Response.json({ status: 'stopped' });
    if (!call || call.id !== body.callId) return error('Chamada não encontrada.', 404);
    if (body.action === 'report') {
      if (invite.mode !== 'operations' || !call.starting || call.expiresAt <= Date.now()) {
        return error('Esta chamada não pode registrar atualizações.', 403);
      }
      const text = cleanText(body.text, 1400);
      const turnId = cleanText(body.turnId, 150);
      if (!text || !turnId) return error('Relato inválido.', 400);
      if (body.speaker !== undefined && body.speaker !== 'assistant' && body.speaker !== 'engineer') return error('Autor inválido.', 400);
      const type = body.speaker === 'assistant' ? 'assistant_turn' : 'engineer_report';
      const key = createHash('sha256').update(type).update(turnId).digest('hex');
      const inserted = await recordRoomEvent(invite.incidentId, { type, sourceKey: `${call.id}:${key}`, text });
      if (inserted && type === 'engineer_report' && rollbackFromSpeech(text, new Date().toISOString())) {
        after(async () => {
          try {
            const incident = await findRoomIncident(invite.incidentId);
            if (incident) await pushBriefings(incident);
          } catch {
            console.warn('Não foi possível enviar a atualização de rollback ao briefing.');
          }
        });
      }
      return Response.json({ saved: true });
    }
    if (body.action === 'start') {
      if (call.expiresAt <= Date.now()) {
        calls.delete(invite.nonce);
        return error('A conexão demorou para ser preparada. Atenda novamente.', 410);
      }
      if (!call.starting) {
        call.startedAt = Date.now();
        call.expiresAt = call.startedAt + CALL_SECONDS * 1000;
        call.starting = (async () => {
          const incident = await findRoomIncident(invite.incidentId);
          if (!incident) throw new Error('Incidente não encontrado.');
          const analysis = invite.mode === 'operations'
            ? Promise.race([
              analyzeChanges(incident).catch(() => undefined),
              new Promise<undefined>(resolve => setTimeout(resolve, 7000)),
            ])
            : Promise.resolve(undefined);
          const [context, rankedChanges] = await Promise.all([roomContext(incident), analysis]);
          const executive = invite.mode === 'briefing' ? briefingContext(context) : undefined;
          if (executive) {
            call.briefingVersion = JSON.stringify(executive);
            call.briefingAt = briefingTimestamp(executive);
          }
          const { greeting } = summary(incident, invite.mode, executive?.lastConsolidatedAt ?? undefined);
          const tools = roomTools(incident.id, call.id, invite.mode, call.expiresAt);
          return startVoice(call.channel, call.uid, greeting,
            executive ?? { ...context, changes: rankedChanges ?? context.changes }, invite.mode, tools);
        })();
      }
      try {
        await call.starting;
      } catch (error) {
        if (calls.get(invite.nonce) === call) calls.delete(invite.nonce);
        throw error;
      }
      return Response.json({ status: 'started' });
    }
    if (body.action === 'stop') {
      const session = await call.starting?.catch(() => undefined);
      if (session) await stopVoice(session.agentId);
      call.expiresAt = 0;
      if (calls.get(invite.nonce) === call) calls.delete(invite.nonce);
      if (session && invite.mode === 'operations') {
        after(async () => {
          try {
            const incident = await findRoomIncident(invite.incidentId);
            if (incident) {
              await finalizeSummary(incident);
              await pushBriefings(incident);
            }
          } catch (issue) {
            console.warn('Resumo final do war room:', issue instanceof Error ? issue.name : 'falhou');
          }
        });
      }
      return Response.json({ status: 'stopped' });
    }
    return error('Ação desconhecida.', 400);
  } catch (issue) {
    const status = (issue as { statusCode?: unknown } | null)?.statusCode;
    console.error('Acionamento de voz:', body.action, issue instanceof Error ? issue.name : 'erro',
      typeof status === 'number' ? status : '');
    if (body.action === 'analyzeChanges' || body.action === 'shareChange') return error('Não foi possível concluir a análise ou compartilhar a mudança. Tente novamente.', 502);
    if (body.action === 'summarize') return error('Não foi possível consolidar o estado com o NeuraLake.', 502);
    if (body.action === 'start') return error('A Agora não conseguiu iniciar o agente de voz. Tente atender novamente.', 502);
    return error('Não foi possível completar o acionamento de voz.', 502);
  }
}
