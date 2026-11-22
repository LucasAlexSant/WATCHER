import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { CALL_SECONDS, rtcCredentials, startVoice, stopVoice } from './agora';

export const runtime = 'nodejs';

type Invite = { incidentId: number; nonce: string; expiresAt: number };
type Call = { id: string; channel: string; uid: number; expiresAt: number; starting?: Promise<string> };
type Evidence = {
  simulated_duration_seconds?: number;
  pix?: { approval_baseline_pct: number; simulated_approval_pct: number };
  gateway?: { baseline_p95_ms: number; simulated_p95_ms: number };
  reconciliation?: { baseline_pending: number; simulated_pending: number };
};
type Incident = {
  id: number; title: string; state: string; priority: string; hypothesis: string | null;
  triage_run_id: number | null;
  recommended_params: { evidence?: Evidence; decision?: { comparisons?: { signal: string; title: string; label: string; source: string }[] } } | null;
};

const calls = new Map<string, Call>();
const inviteMinutes = 30;

async function rows<T>(table: string): Promise<T[]> {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key || !process.env.SUPABASE_URL) throw new Error('Supabase não configurado.');
  const response = await fetch(new URL(`/rest/v1/${table}`, process.env.SUPABASE_URL), {
    headers: { apikey: key }, signal: AbortSignal.timeout(8000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  return response.json();
}

async function getIncident(id?: number) {
  const filter = id === undefined ? 'order=opened_at.desc,id.desc' : `id=eq.${id}`;
  const [incident] = await rows<Incident>(
    `incidents?select=id,title,state,priority,hypothesis,triage_run_id,recommended_params&service_id=eq.pix-demo&triage_run_id=not.is.null&${filter}&limit=1`,
  );
  return incident?.triage_run_id ? incident : undefined;
}

async function getOnCall() {
  const [entry] = await rows<{ responder_id: number }>(
    'service_oncall?select=responder_id&service_id=eq.pix-demo&order=priority.asc,responder_id.asc&limit=1',
  );
  if (entry) {
    const [responder] = await rows<{ name: string }>(`responders?select=name&id=eq.${entry.responder_id}&limit=1`);
    if (responder?.name) return { name: responder.name, assigned: true };
  }
  return { name: 'Plantão de Pagamentos', assigned: false };
}

function signature(encoded: string) {
  const secret = process.env.CALL_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error('Assinatura de links não configurada.');
  return createHmac('sha256', secret).update(encoded).digest();
}

function createInvite(incidentId: number) {
  const invite: Invite = { incidentId, nonce: randomUUID(), expiresAt: Date.now() + inviteMinutes * 60000 };
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
  return invite;
}

function summary(incident: Incident) {
  const evidence = incident.recommended_params?.evidence;
  const pix = evidence?.pix;
  const metrics = pix ? `A aprovação do Pix caiu de ${pix.approval_baseline_pct.toLocaleString('pt-BR')} para ${pix.simulated_approval_pct} por cento.` : '';
  const status = incident.state === 'RESOLVED' ? 'O incidente já consta como resolvido.' : 'O incidente está diagnosticado.';
  const greeting = `Olá, aqui é a Central de Operações do SOS Live. Este é um acionamento de demonstração para o incidente ${incident.id}, prioridade ${incident.priority}. ${status} ${metrics} A triagem encontrou sinais no gateway e na conciliação. Posso explicar as evidências.`.replace(/ +/g, ' ');
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
      const incident = await getIncident(body.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const recipient = await getOnCall();
      const { token, expiresAt } = createInvite(incident.id);
      return Response.json({ url: `${publicOrigin ?? origin}/acionamento#${token}`, recipient, expiresAt });
    }

    const invite = readInvite(body.token, body.action === 'stop' ? CALL_SECONDS : 0);
    if (!invite) return error('Link inválido ou expirado. Peça um novo acionamento.', 401);
    if (body.action === 'preview') {
      const incident = await getIncident(invite.incidentId);
      if (!incident) return error('Incidente triado não encontrado.', 404);
      const { evidence } = summary(incident);
      return Response.json({ id: incident.id, title: incident.title, priority: incident.priority, state: incident.state, pix: evidence?.pix, expiresAt: invite.expiresAt });
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
    if (!call || call.id !== body.callId) return error('Chamada não encontrada.', 404);
    if (body.action === 'start') {
      if (call.expiresAt <= Date.now()) {
        calls.delete(invite.nonce);
        return error('A conexão demorou para ser preparada. Atenda novamente.', 410);
      }
      if (!call.starting) {
        call.expiresAt = Date.now() + CALL_SECONDS * 1000;
        call.starting = (async () => {
          const incident = await getIncident(invite.incidentId);
          if (!incident) throw new Error('Incidente não encontrado.');
          const { evidence, greeting } = summary(incident);
          const comparisons = (incident.recommended_params?.decision?.comparisons ?? [])
            .filter(item => item.label === 'related' && item.source === 'demo')
            .map(({ title, signal }) => ({ title, signal }));
          return startVoice(call.channel, call.uid, greeting, { evidence, comparisons, hypothesis: incident.hypothesis });
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
    console.error('Acionamento de voz:', issue instanceof Error ? issue.name : 'erro');
    return error('Não foi possível completar o acionamento de voz.', 502);
  }
}
