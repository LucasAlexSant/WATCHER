import { demoChanges, type ChangeReview } from './change-types';
import type { ConsolidatedState } from './neuralake';
import { mergeRollback, rollbackFromSpeech, rollbackLabels, type RollbackUpdate } from './rollback';

export type RoomEvent = {
  id: number;
  at: string;
  payload: {
    namespace: 'sos-warroom';
    type: 'engineer_report' | 'assistant_turn' | 'checkpoint' | 'change_analysis' | 'change_shared';
    sourceKey: string;
    text?: string;
    summary?: string;
    decision?: string;
    nextStep?: string;
    owner?: string;
    changes?: ChangeReview[];
    changeId?: string;
    cadence?: 'periodic' | 'manual';
    provider?: 'neuralake';
    throughReportId?: number;
    consolidated?: ConsolidatedState;
  };
};

type Comparison = { at?: string; title: string; signal: string; label: string; source: string; probability?: number };

export type RoomIncident = {
  id: number; title: string; state: string; priority: string; hypothesis: string | null;
  opened_at: string; diagnosed_at: string | null; resolved_at: string | null; triage_run_id: number | null;
  recommended_params: {
    evidence?: {
      simulated_duration_seconds?: number;
      pix?: { approval_baseline_pct: number; simulated_approval_pct: number };
      gateway?: { baseline_p95_ms: number; simulated_p95_ms: number };
      reconciliation?: { baseline_pending: number; simulated_pending: number };
    };
    decision?: { comparisons?: Comparison[] };
  } | null;
};

export async function database<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key || !process.env.SUPABASE_URL) throw new Error('Supabase não configurado.');
  const response = await fetch(new URL(`/rest/v1/${path}`, process.env.SUPABASE_URL), {
    ...init, headers: { apikey: key, ...init?.headers },
    signal: AbortSignal.timeout(6500), cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    console.error('War room Supabase:', path.split('?')[0], response.status, body?.code);
    throw new Error(`Supabase HTTP ${response.status}`);
  }
  return response.json();
}

export async function findRoomIncident(id?: number) {
  const filter = id === undefined ? 'order=opened_at.desc,id.desc' : `id=eq.${id}`;
  const [incident] = await database<RoomIncident[]>(
    `incidents?select=id,title,state,priority,hypothesis,opened_at,diagnosed_at,resolved_at,triage_run_id,recommended_params&service_id=eq.pix-demo&triage_run_id=not.is.null&${filter}&limit=1`,
  );
  return incident;
}

export function roomEventHistory(id: number, type: RoomEvent['payload']['type'], limit: number) {
  return database<RoomEvent[]>(
    `incident_events?select=id,at,payload&incident_id=eq.${id}&payload->>namespace=eq.sos-warroom&payload->>type=eq.${type}&order=id.desc&limit=${limit}`,
  );
}

export function cleanText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit)
    .replace(/\b(?:sb_secret_|apikey_|nlk[-_]|sk-)[\w-]+/gi, '[segredo removido]') : '';
}

const writes = new Map<string, Promise<boolean>>();

export async function recordRoomEvent(id: number, data: Omit<RoomEvent['payload'], 'namespace'>) {
  const key = `${id}:${data.sourceKey}`;
  const inFlight = writes.get(key);
  if (inFlight) return inFlight;

  const result = (async () => {
    const query = new URLSearchParams({
      select: 'id', incident_id: `eq.${id}`, 'payload->>namespace': 'eq.sos-warroom',
      'payload->>sourceKey': `eq.${data.sourceKey}`, limit: '1',
    });
    const existing = await database<{ id: number }[]>(`incident_events?${query}`);
    if (existing.length) return false;
    await database<RoomEvent[]>('incident_events?select=id,at,payload', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        incident_id: id, kind: 'notice', source: 'monitor', narrated: false,
        payload: { ...data, namespace: 'sos-warroom' },
      }),
    });
    return true;
  })();

  writes.set(key, result);
  try {
    return await result;
  } finally {
    if (writes.get(key) === result) writes.delete(key);
  }
}

export async function roomContext(incident: RoomIncident) {
  const [reportsNewest, checkpoints, analyses, shared, alerts] = await Promise.all([
    roomEventHistory(incident.id, 'engineer_report', 8),
    roomEventHistory(incident.id, 'checkpoint', 12),
    roomEventHistory(incident.id, 'change_analysis', 1),
    roomEventHistory(incident.id, 'change_shared', 15),
    database<{ received_at: string; check_name: string; status: string; severity: string }[]>(
      `alerts?select=received_at,check_name,status,severity&incident_id=eq.${incident.id}&service_id=eq.pix-demo&order=received_at.asc&limit=12`,
    ),
  ]);
  const selected = incident.recommended_params?.decision?.comparisons ?? [];
  const related = selected.filter(x => x.label === 'related' && x.source === 'demo');
  const historyOnly = selected.filter(x => x.label === 'related' && x.source !== 'demo')
    .map(({ at, title, signal }) => ({ at, title, signal, evidence: 'somente metadados; correlação não confirmada' }));
  const timeline = [
    ...alerts.map(a => ({
      at: a.received_at, type: 'alerta do incidente', title: 'Alerta de aprovação do PIX', detail: `Severidade ${a.severity}. Estado atual do alerta: ${a.status}.`,
    })),
    ...related.map(event => ({ at: event.at, type: 'sinal correlacionado · demonstração', title: event.title, detail: event.signal })),
    { at: incident.diagnosed_at, type: 'triagem', title: 'Prioridade definida', detail: incident.priority },
    { at: incident.resolved_at, type: 'resolução', title: 'Incidente encerrado no painel', detail: 'Registro de resolução da simulação.' },
  ].filter(item => item.at).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  const [checkpoint] = checkpoints;
  const rollback = [...reportsNewest].reverse().reduce<RollbackUpdate | undefined>((state, event) =>
    mergeRollback(state, rollbackFromSpeech(event.payload.text ?? '', event.at)),
    checkpoints.find(event => event.payload.consolidated?.rollback)?.payload.consolidated?.rollback);
  const reports = reportsNewest.filter(event => !checkpoint || event.id > (checkpoint.payload.throughReportId ?? checkpoint.id)).reverse();
  return {
    incident: { id: incident.id, title: incident.title, state: incident.state, priority: incident.priority, hypothesis: incident.hypothesis },
    evidence: incident.recommended_params?.evidence,
    related,
    historyOnly,
    timeline,
    checkpoint: checkpoint ? { at: checkpoint.at, ...checkpoint.payload } : null,
    rollback,
    reports: reports.map(event => ({ at: event.at, text: event.payload.text })),
    checkpoints: checkpoints.map(event => ({
      id: event.id, at: event.at, summary: event.payload.summary,
      nextStep: event.payload.nextStep, decision: event.payload.decision, owner: event.payload.owner,
      cadence: event.payload.cadence, provider: event.payload.provider, consolidated: event.payload.consolidated,
    })),
    changeCandidates: demoChanges(incident.opened_at),
    changes: analyses[0]?.payload.changes ?? [],
    sharedChanges: shared.flatMap(event => event.payload.changeId ? [event.payload.changeId] : []),
  };
}

export function briefingContext(room: Awaited<ReturnType<typeof roomContext>>) {
  const checkpoint = room.checkpoints.find(item => item.provider === 'neuralake') ?? room.checkpoint;
  const lastAt = checkpoint?.at ?? null;
  return {
    incident: room.incident,
    evidence: room.evidence,
    timeline: room.timeline,
    lastConsolidatedAt: lastAt,
    lastConsolidatedAtBrasilia: lastAt ? new Date(lastAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null,
    rollback: room.rollback ? { ...room.rollback, description: rollbackLabels[room.rollback.stage] } : null,
    checkpoint: checkpoint ? {
      summary: checkpoint.summary, decision: checkpoint.decision,
      nextStep: checkpoint.nextStep, owner: checkpoint.owner, consolidated: checkpoint.consolidated,
    } : null,
    latestOperationalNote: room.checkpoint && room.checkpoint.at !== lastAt ? {
      at: room.checkpoint.at, summary: room.checkpoint.summary, decision: room.checkpoint.decision,
    } : null,
    unconsolidatedReports: room.reports.length,
    changeSuspects: room.changes.filter(change => change.label === 'related').slice(0, 4),
  };
}

type DirectoryIncident = Pick<RoomIncident, 'id' | 'title' | 'priority' | 'state' | 'opened_at' | 'resolved_at'>;

export async function listWarRooms() {
  const selection = 'incidents?select=id,title,priority,state,opened_at,resolved_at&service_id=eq.pix-demo&triage_run_id=not.is.null&order=opened_at.desc,id.desc';
  const [active, resolved] = await Promise.all([
    database<DirectoryIncident[]>(`${selection}&state=neq.RESOLVED&limit=30`),
    database<DirectoryIncident[]>(`${selection}&state=eq.RESOLVED&limit=15`),
  ]);
  const incidents = [...active, ...resolved];
  if (!incidents.length) return [];
  const notes = await database<(RoomEvent & { incident_id: number })[]>(
    `incident_events?select=incident_id,id,at,payload&incident_id=in.(${incidents.map(item => item.id).join(',')})&payload->>namespace=eq.sos-warroom&payload->>type=eq.checkpoint&order=id.desc&limit=160`,
  );
  const latest = new Map<number, RoomEvent>();
  for (const note of notes) {
    if (!latest.has(note.incident_id)) latest.set(note.incident_id, note);
  }
  return incidents.map(incident => {
    const note = latest.get(incident.id);
    return {
      ...incident,
      updatedAt: note?.at ?? null,
      summary: note?.payload.summary ?? null,
      status: note?.payload.consolidated?.status ?? null,
      finding: note?.payload.consolidated?.findings?.at(-1) ?? null,
      completedAction: note?.payload.consolidated?.completedActions?.at(-1) ?? null,
      rollback: note?.payload.consolidated?.rollback ?? null,
      nextStep: note?.payload.consolidated?.actions[0]?.task ?? note?.payload.nextStep ?? null,
    };
  });
}
