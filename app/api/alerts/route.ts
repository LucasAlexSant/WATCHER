import { assessPriority } from './jev';
import { demoCandidates, type Candidate, type Comparison } from './candidates';

export const runtime = 'nodejs';

const service = 'pix-demo';
const simulatedDurationSeconds = 180;
const tickets = new Map<string, Promise<Response>>();

type Alert = { id: number; received_at: string; status: string; incident_id: number | null; triage_run_id: number | null };
type Incident = { id: number; priority: string; recommended_params: { evidence?: Evidence; decision?: { source: string; model?: string; confidence?: number; comparisons?: Comparison[] } } | null };
type Evidence = Awaited<ReturnType<typeof collectEvidence>>['evidence'];

async function database<T>(table: string, options: RequestInit = {}): Promise<T> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('Supabase ainda não configurado.');
  const response = await fetch(new URL(`/rest/v1/${table}`, base), {
    ...options,
    headers: { apikey: key, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    console.error('Supabase incident workflow:', table.split('?')[0], response.status, problem.code);
    throw new Error('O Supabase recusou a operação.');
  }
  const content = await response.text();
  return content ? JSON.parse(content) as T : undefined as T;
}

function write<T>(table: string, method: 'POST' | 'PATCH', body: object, prefer = 'return=representation') {
  return database<T>(table, { method, headers: { Prefer: prefer }, body: JSON.stringify(body) });
}

async function collectEvidence(end: number) {
  // Keep the comparison window stable when Jev is retried.
  const simulatedOnset = end - simulatedDurationSeconds * 1000;
  const start = end - 15 * 60000;
  const from = new Date(start).toISOString();
  const to = new Date(end).toISOString();
  const range = `opened_at=gte.${from}&opened_at=lte.${to}`;
  const [history, checks, deploys] = await Promise.all([
    database<{ service_id: string; priority: string; state: string; opened_at: string }[]>(`incidents?select=service_id,priority,state,opened_at&${range}&order=opened_at.desc&limit=15`),
    database<{ ok: boolean }[]>(`health_checks?select=ok&service_id=eq.${service}&order=at.desc&limit=10`),
    database<{ deployed_at: string }[]>(`deployments?select=deployed_at&service_id=eq.${service}&order=deployed_at.desc&limit=1`),
  ]);
  const lastDeploy = deploys[0]?.deployed_at ?? null;
  const candidates: Candidate[] = [
    ...demoCandidates(simulatedOnset, start, end),
    ...history.map(row => ({
      at: row.opened_at, source: 'supabase' as const, title: row.service_id,
      signal: `Metadados do incidente: prioridade ${row.priority}; estado ${row.state}. Sem evidência de dependência nos campos consultados.`,
    })),
  ].sort((first, second) => first.at.localeCompare(second.at));
  const evidence = {
    simulation: true,
    window: { from, to },
    simulated_duration_seconds: simulatedDurationSeconds,
    pix: { approval_baseline_pct: 99.7, simulated_approval_pct: 58 },
    gateway: { baseline_p95_ms: 182, simulated_p95_ms: 1590 },
    reconciliation: { baseline_pending: 24, simulated_pending: 390 },
    history: { recent_incidents_sampled: history.length, recent_p1: history.filter(row => row.priority === 'P1').length },
    checks: { sampled: checks.length, failed: checks.filter(row => !row.ok).length },
    last_deploy_at: lastDeploy,
  };
  return { evidence, candidates };
}

function result(incident: Incident) {
  return Response.json({
    status: 'recorded', id: incident.id, priority: incident.priority,
    source: incident.recommended_params?.decision?.source,
    comparisons: incident.recommended_params?.decision?.comparisons ?? [],
    history: incident.recommended_params?.evidence?.history.recent_incidents_sampled,
  });
}

async function processAlert(action: string, externalId: string): Promise<Response> {
  const fingerprint = `pix-demo:${externalId}`;
  const query = `alerts?select=id,received_at,status,incident_id,triage_run_id&service_id=eq.${service}&external_id=eq.${externalId}&limit=1`;
  let [alert] = await database<Alert[]>(query);

  if (action === 'start') {
    if (!alert) {
      await write('services?on_conflict=id', 'POST', {
        id: service, name: 'PIX (simulação)', environment: 'demo', dependencies: [],
        business_impact: 'Simulação de falhas em pagamentos PIX.', noise_rules: {}, enabled: false,
      }, 'resolution=ignore-duplicates,return=minimal');
      [alert] = await write<Alert[]>('alerts?select=id,received_at,status,incident_id,triage_run_id', 'POST', {
        source: 'monitor', external_id: externalId, service_id: service, environment: 'demo',
        check_name: 'pix-approval-simulation', status: 'firing', severity: 'critical',
        fingerprint, verdict: 'grouped', payload: { simulation: true, simulated_duration_seconds: simulatedDurationSeconds },
      });
    }
    return Response.json({ status: 'started', startedAt: alert.received_at });
  }

  if (!alert) return Response.json({ error: 'Alerta não encontrado.' }, { status: 404 });

  if (action === 'stop') {
    if (alert.status === 'firing') {
      await write(`alerts?id=eq.${alert.id}`, 'PATCH', { status: 'resolved' }, 'return=minimal');
    }
    if (alert.incident_id) {
      await write(`incidents?id=eq.${alert.incident_id}&state=eq.DIAGNOSED`, 'PATCH', {
        state: 'RESOLVED', resolved_at: new Date().toISOString(),
      }, 'return=minimal');
    }
    return Response.json({ status: 'stopped' });
  }

  if (alert.status !== 'firing') return Response.json({ status: 'stopped' });

  let [incident] = await database<Incident[]>(
    `incidents?select=id,priority,recommended_params&service_id=eq.${service}&fingerprint=eq.${fingerprint}&limit=1`,
  );
  if (!incident) {
    const { evidence, candidates } = await collectEvidence(Date.parse(alert.received_at));
    const decision = await assessPriority(evidence, candidates);
    if (decision.status === 'pending') {
      return Response.json({ status: 'pending', candidates, reason: decision.reason, retryIn: 30 });
    }
    [incident] = await write<Incident[]>('incidents?select=id,priority,recommended_params', 'POST', {
      service_id: service, fingerprint, state: 'DIAGNOSED', priority: decision.priority,
      title: '[SIMULAÇÃO] Queda na aprovação do PIX',
      opened_at: alert.received_at, diagnosed_at: new Date().toISOString(),
      hypothesis: 'Atrasos na confirmação simulada do PIX sobrecarregam gateway e conciliação.',
      confidence: decision.confidence, interview: {}, recommended_params: { evidence, decision },
    });
  }

  let triageId = alert.triage_run_id;
  if (!triageId) {
    const summary = incident.recommended_params;
    const [existing] = await database<{ id: number }[]>(`triage_runs?select=id&incident_id=eq.${incident.id}&fingerprint=eq.${fingerprint}&limit=1`);
    const [triage] = existing ? [existing] : await write<{ id: number }[]>('triage_runs?select=id', 'POST', {
      fingerprint, service_id: service, incident_id: incident.id, priority: incident.priority,
      status: 'escalated', final_verdict: 'escalate', user_impact: false,
      reason: 'Prioridade avaliada pelo Jev após comparação da janela de 15 minutos.',
      evidence: { ...summary?.evidence, comparisons: summary?.decision?.comparisons ?? [] },
      confidence: summary?.decision?.confidence,
      tool_calls: [], finished_at: new Date().toISOString(),
      model: summary?.decision?.model ?? null,
    });
    triageId = triage.id;
  }
  await write(`incidents?id=eq.${incident.id}`, 'PATCH', { triage_run_id: triageId }, 'return=minimal');
  await write(`alerts?id=eq.${alert.id}`, 'PATCH', { incident_id: incident.id, triage_run_id: triageId }, 'return=minimal');
  return result(incident);
}

export async function POST(request: Request) {
  const host = request.headers.get('host');
  if (process.env.NODE_ENV !== 'development' || !host ||
      !/^(localhost|127\.0\.0\.1):\d+$/.test(host) ||
      request.headers.get('origin') !== `http://${host}`) {
    return Response.json({ error: 'Rota disponível apenas no painel local.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!['start', 'check', 'stop'].includes(body?.action) ||
      typeof body?.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(body.id)) {
    return Response.json({ error: 'Alerta inválido.' }, { status: 400 });
  }

  const { id, action } = body as { id: string; action: string };
  const previous = tickets.get(id);
  const work = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(() => processAlert(action, id));
  tickets.set(id, work);
  try {
    return await work;
  } catch (error) {
    console.error('Simulation alert failed:', error instanceof Error ? error.message : 'unknown error');
    return Response.json({ error: 'Não foi possível sincronizar o alerta.' }, { status: 502 });
  } finally {
    if (tickets.get(id) === work) tickets.delete(id);
  }
}
