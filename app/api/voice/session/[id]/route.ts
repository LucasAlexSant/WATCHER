import { after, type NextRequest } from 'next/server';
import { centralActions, changeDevice, changeVoice, confirmVoice, limit, requireVoice } from '@/lib/db';
import { json, route } from '@/lib/http';
import { protocol } from '@/lib/incidents';
import { operator, voiceOwner } from '@/lib/security';
import { coordinatesFrom, deviceFrom, InputError, positiveInt, uuid } from '@/lib/validation';
import { reportSubmission } from '@/lib/report-submission';
import { audioToken, signalChange, startAgent, stopAgent, tellAgentConfirmed } from '@/lib/voice';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return route(async () => {
    const id = uuid((await context.params).id);
    const session = await requireVoice(id, voiceOwner(request));
    if (session.purpose === 'insights') {
      operator(request);
      const cursor = request.nextUrl.searchParams.get('after') ?? '0';
      if (!/^\d{1,18}$/.test(cursor)) throw new InputError('Cursor inválido.');
      return json({ state: session.state, commands: session.state === 'active' ? await centralActions(id, cursor) : [] });
    }
    return json({ draft: session.draft ? { report: session.draft, revision: session.revision } : null,
      mapEvent: session.device_location?.mapEvent ?? null,
      state: session.state, receipt: session.incident_id ? protocol(session.incident_id) : null });
  });
}

export async function POST(request: NextRequest, context: Context) {
  return route(async () => {
    const id = uuid((await context.params).id);
    const owner = voiceOwner(request);
    const session = await requireVoice(id, owner);
    const { input, photos } = await reportSubmission(request);

    switch (input.action) {
      case 'start': {
        if (session.purpose === 'insights') operator(request);
        if (session.state === 'active') return json({ active: true, agentId: session.agent_id });
        if (!await changeVoice(id, 'prepared', 'starting')) throw new InputError('A sessão já iniciou ou terminou.', 409);
        let agentId: string;
        try {
          await limit('voice:start', 20, 60);
          agentId = await startAgent(id, session.channel, session.uid, session.purpose);
        } catch (error) {
          await changeVoice(id, 'starting', 'stopped');
          console.warn('[sos-live] Agora não iniciou a sessão', error instanceof Error ? error.name : '');
          if (error instanceof InputError) throw error;
          throw new InputError('A Agora não iniciou a conversa. Tente novamente em instantes.', 502);
        }
        if (!await changeVoice(id, 'starting', 'active', agentId)) {
          await stopAgent(agentId);
          throw new InputError('A conversa foi encerrada.', 409);
        }
        return json({ active: true, agentId });
      }
      case 'renew': {
        if (session.purpose === 'insights') operator(request);
        if (session.state !== 'active') throw new InputError('A sessão terminou.', 409);
        return json(audioToken(session.uid, session.channel));
      }
      case 'stop': {
        for (const state of ['prepared', 'starting', 'active'] as const) {
          const stopped = await changeVoice(id, state, 'stopped');
          if (!stopped) continue;
          if (stopped.agent_id) await stopAgent(stopped.agent_id);
          break;
        }
        return json({ stopped: true });
      }
      case 'location': {
        if (session.purpose !== 'report') throw new InputError('Esta sessão não recebe localização.', 403);
        await changeDevice(id, owner, deviceFrom(input.device));
        return json({ ok: true });
      }
      case 'confirm': {
        if (input.confirmed !== true) throw new InputError('Confirme o resumo antes do envio.');
        const revision = positiveInt(input.revision, 'Revisão');
        const coordinates = input.coordinates == null ? null : coordinatesFrom(input.coordinates);
        const result = await confirmVoice(id, owner, revision, coordinates, photos);
        if (result.created) after(() => Promise.all([
          signalChange(), result.agentId ? tellAgentConfirmed(result.agentId, result.channel) : Promise.resolve(),
        ]).then(() => undefined));
        return json({ protocol: protocol(result.incident.id) }, result.created ? 201 : 200);
      }
      default:
        throw new InputError('Ação inválida.');
    }
  });
}
