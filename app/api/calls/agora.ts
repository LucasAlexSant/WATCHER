import { AgoraClient, Agent, Area, DeepgramSTT, generateRtcToken, MiniMaxTTS, OpenAI } from 'agora-agents';

export const AGENT_UID = 123456;
export const CALL_SECONDS = 600;

function config() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) throw new Error('Agora ainda não configurada.');
  return { appId, appCertificate };
}

function client() {
  return new AgoraClient({ area: Area.US, ...config() });
}

class PortugueseVoice extends MiniMaxTTS {
  toConfig() {
    const config = super.toConfig();
    Object.assign(config.params, { language_boost: 'Portuguese' });
    return config;
  }
}

export function rtcCredentials(channel: string, uid: number) {
  const { appId, appCertificate } = config();
  const token = generateRtcToken({ appId, appCertificate, channel, uid, expirySeconds: CALL_SECONDS });
  return { appId, token, channel, uid, agentUid: AGENT_UID, expiresIn: CALL_SECONDS };
}

export async function startVoice(channel: string, uid: number, briefing: string, context: object) {
  const instructions = `Você atende um engenheiro de plantão em português do Brasil. Faça uma passagem de incidente simulada e curta. Use apenas os dados do briefing e do contexto abaixo. Distinga evidência de hipótese: a correlação não confirma causa raiz. Se faltar informação, diga que ainda não foi coletada. Não afirme que você executou ações, enviou mensagens ou alterou o ambiente. Não peça credenciais. Responda às perguntas do engenheiro e sugira verificações sem executá-las.
Briefing: ${briefing}
Contexto de triagem: ${JSON.stringify(context)}`;
  const agent = new Agent({ client: client(), instructions, greeting: briefing })
    .withStt(new DeepgramSTT({ model: 'nova-3', language: 'pt-BR' }))
    .withLlm(new OpenAI({ model: 'gpt-4.1-mini', greetingMessage: briefing, maxHistory: 12 }))
    .withTts(new PortugueseVoice({ model: 'speech_2_6_turbo', voiceId: 'Portuguese_SereneWoman' }));
  return agent.createSession({
    channel, agentUid: String(AGENT_UID), remoteUids: [String(uid)],
    idleTimeout: 30, expiresIn: CALL_SECONDS, maxDuration: CALL_SECONDS,
  }).start();
}

export async function stopVoice(agentId: string) {
  try {
    await client().stopAgent(agentId);
  } catch (error) {
    const response = error as { statusCode?: number; body?: { reason?: string; detail?: string } };
    if (response.statusCode !== 404 && response.body?.reason !== 'TaskNotRunning' &&
        !response.body?.detail?.toLowerCase().includes('already in the process of shutting down')) throw error;
  }
}
