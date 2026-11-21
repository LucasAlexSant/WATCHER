import { incidentsSince } from './db';
import { insightArea, municipality, stateCode } from './geography';
import { categories, normalizeCity, protocol, verificationLabels, type Category } from './incidents';
import { content, InputError } from './validation';

export async function regionalInsights(input: Record<string, unknown>) {
  const city = content(input.city ?? '', 'Município', 0, 100);
  const region = content(input.region ?? '', 'Região', 0, 100);
  const days = input.days === '' || input.days == null ? 7 : Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new InputError('Informe de 1 a 365 dias.');
  const area = insightArea(city, region);
  if ('choices' in area) return {
    area: null, total: 0, days, verified: 0, reviewing: 0, unverified: 0,
    categories: [], recent: [], choices: area.choices,
    message: area.choices.length ? 'Confirme a UF do município.' : 'Região não identificada. Informe município com UF, estado ou região do Brasil.',
  };
  const windowStart = new Date(Date.now() - days * 86_400_000).toISOString();
  const source = await incidentsSince(windowStart);
  const applicable = source.filter((row) => {
    if (row.verification === 'dismissed') return false;
    if (!area.states.length) return true;
    const uf = stateCode(row.uf ?? '') ?? municipality(row.city)?.uf;
    return Boolean(uf && area.states.includes(uf)) &&
      (!area.city || (row.city && normalizeCity(row.city) === normalizeCity(area.city)));
  });
  const counts = new Map<Category, number>();
  for (const row of applicable) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return {
    area: area.label, days, total: applicable.length,
    verified: applicable.filter(({ verification }) => verification === 'verified').length,
    reviewing: applicable.filter(({ verification }) => verification === 'reviewing').length,
    unverified: applicable.filter(({ verification }) => verification === 'unverified').length,
    categories: [...counts].sort((a, b) => b[1] - a[1]).map(([category, total]) => ({ label: categories[category], total })),
    recent: applicable.slice(0, 4).map((entry) => ({
      protocol: protocol(entry.id), category: categories[entry.category],
      municipality: municipality(entry.city, entry.uf)?.name ?? null,
      verification: verificationLabels[entry.verification], createdAt: entry.createdAt,
    })),
    choices: [],
    message: applicable.length ? 'Relatos no SOS Live no período. As categorias estão ordenadas por frequência.' : 'Sem relatos registrados para esse recorte do SOS Live.',
  };
}

export type InsightResult = Awaited<ReturnType<typeof regionalInsights>>;
