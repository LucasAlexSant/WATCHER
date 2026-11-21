import { decideVoiceLocation, limit, requireToolSession, stageDraft, voiceReceipt } from '@/lib/db';
import { regionalInsights } from '@/lib/insights';
import { moveCentralMap, openCentralIncident } from '@/lib/central-tools';
import { json, route } from '@/lib/http';
import { protocol } from '@/lib/incidents';
import { authorizeTool } from '@/lib/security';
import { body, InputError, reportFrom, uuid } from '@/lib/validation';

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const start = performance.now();
  const { tool } = await params;
  let trace: Record<string, string | boolean | number> = {};
  const response = await route(async () => {
    const input = await body(request);
    const id = uuid(input.id);
    authorizeTool(request, id);
    const central = tool === 'insights' || tool === 'move-map' || tool === 'open-incident';
    const session = await requireToolSession(id, central ? 'insights' : 'report');
    await limit(`tools:${id}`, 45, 300);
    switch (tool) {
      case 'draft': {
        const { revision, report } = await stageDraft(id, reportFrom(input, true));
        trace = { revisao: revision, pontoConfirmado: report.coordinates?.precision === 'confirmed' };
        return json({ revisao: revision, registrado: false, instrucao: 'Leia o resumo e peça para confirmar na tela.' });
      }
      case 'receipt': {
        const receipt = await voiceReceipt(id);
        trace = { registrado: Boolean(receipt) };
        return json({ registrado: Boolean(receipt), protocolo: receipt ? protocol(receipt) : null });
      }
      case 'location': {
        const decision = input.decision === 'confirmar' || input.decision === 'descartar' ? input.decision : 'consultar';
        const location = await decideVoiceLocation(id, session.device_location, decision);
        const confirmed = location?.confirmedForIncident === true ? location : null;
        const pending = location?.confirmedForIncident === false && Boolean(location.coordinates);
        const mapSent = Boolean(location?.coordinates && location.mapEvent);
        trace = { decisao: decision, mapaEnviado: mapSent,
          pontoDisponivel: pending || Boolean(confirmed), pontoConfirmado: Boolean(confirmed) };
        return json({ pontoDisponivelNoMapa: pending || Boolean(confirmed), confirmado: Boolean(confirmed), municipioSugerido: confirmed?.city ?? null,
          ufSugerida: confirmed?.uf ?? null, ponto: confirmed?.coordinates ?? null, mapaEnviado: mapSent,
          ruaSugerida: confirmed?.street ?? null, bairroSugerido: confirmed?.neighborhood ?? null,
          numeroSugerido: confirmed?.houseNumber ?? null,
          instrucao: confirmed
            ? 'O ponto está confirmado e será exibido no mapa. Use a localização disponível no resumo. Siga para os dados da ocorrência, sem fazer mais perguntas sobre o local.'
            : pending
              ? 'Há um ponto estimado no mapa. Diga que marcou e pergunte se o ponto está correto. Aguarde a resposta falada.'
              : 'Sem ponto do GPS disponível. Comece pelo bairro se ainda não foi informado. Em outra fala, peça o ponto de referência.' });
      }
      case 'insights':
        return json(await regionalInsights(input));
      case 'move-map':
        return json(await moveCentralMap(id, input));
      case 'open-incident':
        return json(await openCentralIncident(id, input));
      default:
        throw new InputError('Ferramenta não encontrada.', 404);
    }
  });
  if (process.env.SOS_DEBUG_AGENT_TOOLS === '1') {
    console.info('[sos-live:agent-tool]', JSON.stringify({
      ferramenta: ['draft', 'receipt', 'location', 'insights', 'move-map', 'open-incident'].includes(tool) ? tool : 'desconhecida',
      status: response.status, ms: Math.round(performance.now() - start), ...trace,
    }));
  }
  return response;
}
