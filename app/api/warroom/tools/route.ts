import { createHash } from 'node:crypto';
import { briefingContext, cleanText, findRoomIncident, recordRoomEvent, roomContext } from '../store';
import { readToolGrant } from '../tools';
import { analyzeChanges, shareChange } from '../changes';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const grant = readToolGrant(request.headers.get('authorization'));
  if (!grant) return Response.json({ error: 'Ferramenta não autorizada.' }, { status: 401 });
  try {
    const incident = await findRoomIncident(grant.incidentId);
    if (!incident) return Response.json({ error: 'Incidente não encontrado.' }, { status: 404 });
    if (grant.operation === 'executive') return Response.json(briefingContext(await roomContext(incident)));
    if (grant.operation === 'context') return Response.json(await roomContext(incident));
    if (grant.operation === 'changes') return Response.json({ changes: await analyzeChanges(incident) });
    if (grant.operation === 'shareChange') {
      const data = await request.json().catch(() => null);
      const id = cleanText(data?.changeId, 40);
      if (!/^(GMUD|DEPLOY)-[0-9]+$/.test(id)) return Response.json({ error: 'ID inválido.' }, { status: 400 });
      const change = await shareChange(incident, id);
      return change ? Response.json({ shared: true, change }) : Response.json({ error: 'Mudança não encontrada.' }, { status: 404 });
    }
    if (grant.operation !== 'checkpoint') return Response.json({ error: 'Operação inválida.' }, { status: 403 });

    const body = await request.json().catch(() => null);
    const state = {
      summary: cleanText(body?.summary, 1000),
      decision: cleanText(body?.decision, 450),
      nextStep: cleanText(body?.nextStep, 450),
      owner: cleanText(body?.owner, 110),
    };
    if (!state.summary) return Response.json({ error: 'O resumo é obrigatório.' }, { status: 400 });
    const digest = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const inserted = await recordRoomEvent(incident.id, {
      type: 'checkpoint', cadence: 'manual', sourceKey: `${grant.callId}:${digest}`, ...state,
    });
    return Response.json({ saved: true, duplicate: !inserted, incidentId: incident.id });
  } catch {
    return Response.json({ error: 'Não foi possível acessar o estado do war room.' }, { status: 502 });
  }
}
