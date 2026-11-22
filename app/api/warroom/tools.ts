import { createHmac, timingSafeEqual } from 'node:crypto';
import type { LlmTool } from 'agora-agents';

export type RoomMode = 'operations' | 'briefing';
type Operation = 'context' | 'checkpoint' | 'changes' | 'shareChange';
type ToolGrant = { incidentId: number; callId: string; expiresAt: number; operation: Operation };

function sign(payload: string) {
  const secret = process.env.CALL_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error('War room signing is unavailable');
  return createHmac('sha256', secret).update('warroom-tool:').update(payload).digest();
}

function makeGrant(grant: ToolGrant) {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

export function readToolGrant(authorization: string | null): ToolGrant | undefined {
  const match = authorization?.match(/^Bearer ([\w-]{1,300})\.([\w-]{43})$/);
  if (!match) return undefined;
  try {
    const expected = sign(match[1]);
    const provided = Buffer.from(match[2], 'base64url');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
    const grant = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as ToolGrant;
    if (!(grant.expiresAt > Date.now()) || !Number.isSafeInteger(grant.incidentId)) return undefined;
    return grant;
  } catch {
    return undefined;
  }
}

export function roomTools(incidentId: number, callId: string, mode: RoomMode, expiresAt: number): LlmTool[] {
  const configured = process.env.WARROOM_TOOLS_ORIGIN ?? process.env.CALL_PUBLIC_ORIGIN;
  if (!configured?.startsWith("https://")) return [];
  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    return [];
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password) return [];

  const endpoint = (operation: Operation, body: Record<string, string> = {}): LlmTool['server'] => ({
    method: 'POST',
    url: new URL('/api/warroom/tools', origin).href,
    headers: {
      Authorization: `Bearer ${makeGrant({ incidentId, callId, expiresAt, operation })}`,
      'Content-Type': 'application/json',
    },
    body,
    timeout_ms: operation === "changes" || operation === "shareChange" ? 35000 : 15000,
  });

  const tools: LlmTool[] = [{
    type: 'function',
    function: {
      name: 'consultarEstadoWarRoom',
      description: 'Retorna o incidente atual, as ocorrências correlacionadas com evidência, os alertas em ordem temporal, o último resumo salvo e os relatos posteriores. Use antes de falar do andamento atual ou explicar o incidente a quem acaba de entrar.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    server: endpoint('context', { request: 'context' }),
  }];
  if (mode === 'operations') tools.push({
    type: 'function',
    function: {
      name: 'analisarMudancasWarRoom',
      description: 'Compara as GMUDs e deploys na janela anterior ao alerta com os sintomas do incidente. Retorna IDs, horários, versões, especificações e chances de correlação ordenadas. Use se perguntarem quais mudanças podem ter contribuído; trate como suspeitas, não como causa raiz comprovada.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    server: endpoint('changes', { request: 'changes' }),
  }, {
    type: 'function',
    function: {
      name: 'compartilharMudancaWarRoom',
      description: 'Compartilha o card de uma GMUD ou deploy na transcrição. Use quando alguém pedir detalhes ou para destacar uma suspeita discutida. Use somente um ID retornado por analisarMudancasWarRoom.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['changeId'],
        properties: { changeId: { type: 'string', description: 'ID exato da mudança analisada.' } },
      },
    },
    server: endpoint('shareChange', { changeId: '{{args.changeId}}' }),
  }, {
    type: 'function',
    function: {
      name: 'salvarEstadoWarRoom',
      description: 'Registra um novo resumo factual para o pós-mortem. Use quando o engenheiro confirmar mudança, decisão, responsável, próximo passo ou pedir para registrar. Campos não informados ficam vazios. Identifique hipóteses como hipóteses no resumo.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['summary', 'decision', 'nextStep', 'owner'],
        properties: {
          summary: { type: 'string', description: 'Estado atual relatado e o que foi efetivamente verificado.' },
          decision: { type: 'string', description: 'Decisão tomada, ou texto vazio.' },
          nextStep: { type: 'string', description: 'Próxima ação combinada, ou texto vazio.' },
          owner: { type: 'string', description: 'Responsável mencionado, ou texto vazio.' },
        },
      },
    },
    server: endpoint('checkpoint', {
      summary: '{{args.summary}}', decision: '{{args.decision}}', nextStep: '{{args.nextStep}}', owner: '{{args.owner}}',
    }),
  });
  return tools;
}
