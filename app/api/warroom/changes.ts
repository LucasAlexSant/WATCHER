import { createHash } from 'node:crypto';
import { choice, evaluate } from '../alerts/jev';
import { demoChanges, type ChangeCandidate, type ChangeReview } from './change-types';
import { database, recordRoomEvent, roomEventHistory, type RoomIncident } from './store';

const comparisonCriteria = {
  related: 'The deployment preceded or overlapped the problem and changed a dependency or behavior that can explain a symptom in this incident. Separate initiating triggers from contributors.',
  unrelated: 'The change affects an independent system or an unrelated part of a system, with a different impact or failure signature.',
  uncertain: 'There is not enough operational evidence to connect or rule out this change. Timing and a version or commit identifier alone are insufficient.',
};

export async function candidateChanges(incident: RoomIncident): Promise<ChangeCandidate[]> {
  const end = incident.opened_at;
  const start = new Date(Date.parse(end) - 15 * 60000).toISOString();
  const query = new URLSearchParams({
    select: 'id,service_id,version,commit_sha,deployed_at',
    service_id: 'in.(pix-demo,checkout-api)',
    order: 'deployed_at.desc',
    limit: '8',
  });
  query.append('deployed_at', `gte.${start}`);
  query.append('deployed_at', `lte.${end}`);
  const deployments = await database<{ id: number; service_id: string; version: string; commit_sha: string | null; deployed_at: string }[]>(`deployments?${query}`);
  return [
    ...demoChanges(end),
    ...deployments.map(row => ({
      id: `DEPLOY-${row.id}`,
      at: row.deployed_at,
      title: `Deploy de ${row.service_id}`,
      service: row.service_id,
      version: row.version,
      detail: row.commit_sha
        ? `Commit ${row.commit_sha.slice(0, 12)}. Sem descrição técnica da mudança no registro.`
        : 'Sem descrição técnica da mudança no registro.',
      source: 'supabase' as const,
    })),
  ];
}

const running = new Map<number, Promise<ChangeReview[]>>();

export function analyzeChanges(incident: RoomIncident) {
  const current = running.get(incident.id);
  if (current) return current;
  const task = doAnalyze(incident);
  running.set(incident.id, task);
  void task.finally(() => {
    if (running.get(incident.id) === task) running.delete(incident.id);
  }).catch(() => undefined);
  return task;
}

async function doAnalyze(incident: RoomIncident): Promise<ChangeReview[]> {
  const [previous] = await roomEventHistory(incident.id, 'change_analysis', 1);
  if (previous?.payload.changes) return previous.payload.changes;
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error('Jev não configurado para analisar GMUDs.');

  const candidates = await candidateChanges(incident);
  const state = {
    incident: {
      title: incident.title, openedAt: incident.opened_at,
      approval: incident.recommended_params?.evidence?.pix,
      signals: (incident.recommended_params?.decision?.comparisons ?? [])
        .filter(item => item.source === 'demo' && item.label === 'related')
        .map(({ title, signal, at }) => ({ title, signal, at })),
    },
    changes: candidates,
  };
  const response = await evaluate(key, state, Object.fromEntries(candidates.map(item => [item.id, {
    type: 'choice' as const,
    instructions: `Based on timing and the mechanism of the failure, what relationship does change ${item.id} have to this PIX incident?`,
    criteria: comparisonCriteria,
  }])));
  const changes = candidates.map(item => {
    const scored = choice(response, item.id, comparisonCriteria);
    const relatedProbability = response.answers[item.id].probabilities.related;
    if (!Number.isFinite(relatedProbability) || relatedProbability < 0 || relatedProbability > 1) throw new Error('Invalid Jev change probability');
    return { ...item, label: scored.label, probability: scored.probability, relatedProbability };
  }).sort((a, b) => b.relatedProbability - a.relatedProbability);
  await recordRoomEvent(incident.id, { type: 'change_analysis', sourceKey: 'gmud-v1', changes });
  return changes;
}

export async function shareChange(incident: RoomIncident, changeId: string) {
  const changes = await analyzeChanges(incident);
  const change = changes.find(item => item.id === changeId);
  if (!change) return null;
  await recordRoomEvent(incident.id, {
    type: 'change_shared', sourceKey: `shared:${createHash('sha256').update(changeId).digest('hex')}`, changeId,
  });
  return change;
}
