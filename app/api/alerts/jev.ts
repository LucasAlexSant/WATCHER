import type { Candidate, Comparison } from './candidates';

const correlationCriteria = {
  related: 'A shared dependency, failure signature, or downstream symptom links the event to the PIX incident.',
  unrelated: 'The evidence identifies a separate dependency or failure with a different scope.',
  uncertain: 'The evidence is too limited to establish or exclude a link. Timing by itself is insufficient.',
} as const;

const priorityCriteria = {
  P1: 'Many PIX confirmations fail and the correlated evidence indicates critical, sustained disruption of payment processing.',
  P2: 'PIX is degraded, but payments still flow and the evidence supports limited or unclear downstream impact.',
} as const;

type Choice = { type: 'choice'; instructions: string; criteria: Record<string, string> };
type JevResponse = {
  model: string;
  answers: Record<string, { type: string; choice: string; probabilities: Record<string, number> }>;
};

export async function evaluate(key: string, state: object, questions: Record<string, Choice>): Promise<JevResponse> {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
  return response.json();
}

export function choice<K extends string>(response: JevResponse, question: string, criteria: Record<K, string>) {
  const answer = response.answers?.[question];
  if (answer?.type !== 'choice' || !Object.hasOwn(criteria, answer.choice)) throw new Error('Invalid Jev choice');
  const label = answer.choice as K;
  const probability = answer.probabilities?.[label];
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid Jev probability');
  return { label, probability };
}

export async function assessPriority(evidence: object, candidates: Candidate[]) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { status: 'pending' as const, reason: 'Aguardando configuração do Jev.' };

  try {
    const events = candidates.map((candidate, index) => ({ ...candidate, ref: `event_${index}` }));
    const questions = Object.fromEntries(events.map(event => [event.ref, {
      type: 'choice' as const,
      instructions: `What operational relationship does ${event.ref} have to the active PIX incident?`,
      criteria: correlationCriteria,
    }]));
    const first = await evaluate(key, { active_incident: evidence, events }, questions);
    const comparisons: Comparison[] = candidates.map((candidate, index) => ({
      ...candidate, ...choice(first, `event_${index}`, correlationCriteria),
    }));
    const second = await evaluate(key, { active_incident: evidence, comparisons }, {
      impact: {
        type: 'choice',
        instructions: 'Which impact tier best describes the active PIX incident given its metrics and the event comparisons?',
        criteria: priorityCriteria,
      },
    });
    const { label, probability } = choice(second, 'impact', priorityCriteria);
    return {
      status: 'complete' as const, priority: label, confidence: probability,
      model: second.model, source: 'jev', comparisons,
    };
  } catch (error) {
    console.error('Jev triage:', error instanceof Error ? error.message : 'unavailable');
    return { status: 'pending' as const, reason: 'Jev indisponível. Triagem aguardando avaliação.' };
  }
}
