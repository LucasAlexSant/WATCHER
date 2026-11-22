import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { CALL_SECONDS, rtcCredentials, startVoice, stopVoice } from './agora';
import { cleanText, database, findRoomIncident, recordRoomEvent, roomContext, type RoomIncident } from '../warroom/store';
import { roomTools, type RoomMode } from '../warroom/tools';
import { analyzeChanges, shareChange } from '../warroom/changes';

export const runtime = 'nodejs';

type Invite = { incidentId: number; nonce: string; expiresAt: number; mode: RoomMode };
type Call = { id: string; channel: string; uid: number; expiresAt: number; startedAt?: number; starting?: Promise<string> };
const calls = new Map<string, Call>();
const inviteMinutes = 30;

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

function createInvite(incidentId: number, mode: RoomMode) {
  const invite: Invite = { incidentId, mode, nonce: randomUUID(), expiresAt: Date.now() + inviteMinutes * 60000 };
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

function summary(incident: RoomIncident, mode: RoomMode) {
  const evidence = incident.recommended_params?.evidence;
  const pix = evidence?.pix;
  const metrics = pix ? `A aprovação do Pix caiu de ${pix.approval_baseline_pct.toLocaleString('pt-BR')} para ${pix.simulated_approval_pct} por cento.` : '';
  const status = incident.state === 'RESOLVED' ? 'O incidente já consta como resolvido.' : 'O incidente está diagnosticado.';
  const question = mode === 'briefing'
    ? 'Quer que eu comece pelo impacto, pelo andamento ou pelos próximos passos?'
    : 'Qual é a atualização mais recente do plantão?';
  const greeting = `Oi, aqui é o war room do SOS Live para o incidente ${incident.id}, prioridade ${incident.priority}. É uma simulação. ${status} ${metrics} ${question}`.replace(/ +/g, ' ');
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
    if (body.action === 'invite') {
      if (!local || origin !== `http://${host}`) return error('Acionamento disponível no painel local.', 403);
      if (body.incidentId !== undefined && (!Number.isSafeInteger(body.incidentId) || body.incidentId <= 0)) return error('Incidente inválido.', 400);
      const incident = await findRoomIncident(body.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const mode = body.mode === 'briefing' ? 'briefing' : 'operations';
      const recipient = mode === 'briefing' ? { name: 'CTO · consulta', assigned: false } : await getOnCall();
      const { token, expiresAt } = createInvite(incident.id, mode);
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
      return Response.json(await roomContext(incident));
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
      calls.set(invite.nonce, { id, channel, uid, expiresAt: now + 45000 });
      return Response.json({ callId: id, ...credentials });
    }

    const call = calls.get(invite.nonce);
    if (!call && body.action === 'stop') return Response.json({ status: 'stopped' });
    if (!call || call.id !== body.callId) return error('Chamada não encontrada.', 404);
    if (body.action === 'recap') {
      if (invite.mode !== 'operations' || !call.startedAt || call.expiresAt <= Date.now()) {
        return error('Esta chamada não pode salvar resumos.', 403);
      }
      const bucket = body.bucket;
      if (!Number.isSafeInteger(bucket) || bucket < 1 || bucket > Math.floor((Date.now() - call.startedAt) / 120000)) {
        return error('Intervalo inválido.', 400);
      }
      const text = cleanText(body.text, 1600);
      const match = text.match(/^resumo do war[ -]?room[.:\s–-]*estado\s*[:–-]?\s*([\s\S]+?)\s+planejamento\s*[:–-]?\s*([\s\S]+)$/i);
      if (!match) return error('Ainda não há um resumo completo do agente.', 400);
      await recordRoomEvent(invite.incidentId, {
        type: 'checkpoint', cadence: 'periodic', sourceKey: `${call.id}:recap:${bucket}`,
        summary: cleanText(match[1], 1000), nextStep: cleanText(match[2], 450),
      });
      return Response.json({ saved: true });
    }
    if (body.action === 'report') {
      if (invite.mode !== 'operations' || !call.starting || call.expiresAt <= Date.now()) {
        return error('Esta chamada não pode registrar atualizações.', 403);
      }
      const text = cleanText(body.text, 1400);
      const turnId = cleanText(body.turnId, 150);
      if (!text || !turnId) return error('Relato inválido.', 400);
      const key = createHash('sha256').update(turnId).digest('hex');
      await recordRoomEvent(invite.incidentId, { type: 'engineer_report', sourceKey: `${call.id}:${key}`, text });
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
          const { greeting } = summary(incident, invite.mode);
          const context = await roomContext(incident);
          const tools = roomTools(incident.id, call.id, invite.mode, call.expiresAt);
          return startVoice(call.channel, call.uid, greeting, context, invite.mode, tools);
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
      const agentId = await call.starting?.catch(() => undefined);
      if (agentId) await stopVoice(agentId);
      if (calls.get(invite.nonce) === call) calls.delete(invite.nonce);
      return Response.json({ status: 'stopped' });
    }
    return error('Ação desconhecida.', 400);
  } catch (issue) {
    const status = (issue as { statusCode?: unknown } | null)?.statusCode;
    console.error('Acionamento de voz:', body.action, issue instanceof Error ? issue.name : 'erro',
      typeof status === 'number' ? status : '');
    if (body.action === 'analyzeChanges' || body.action === 'shareChange') return error('Não foi possível concluir a análise ou compartilhar a mudança. Tente novamente.', 502);
    if (body.action === 'start') return error('A Agora não conseguiu iniciar o agente de voz. Tente atender novamente.', 502);
    return error('Não foi possível completar o acionamento de voz.', 502);
  }
}
