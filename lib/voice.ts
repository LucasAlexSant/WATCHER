import { randomInt } from 'node:crypto';
import { AgoraClient, Agent, Area, DeepgramSTT, ExpiresIn, generateConvoAIToken, MiniMaxTTS, OpenAI, type LlmTool } from 'agora-agents';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import { DEFAULT_AGENT_UID } from './agora';
import { categories, type VoicePurpose } from './incidents';
import { operatorChannel, toolToken } from './security';
import { InputError } from './validation';

const lifetime = 20 * 60;
const greeting = 'Olá, aqui é o SOS Live. Esta é uma simulação e o relato não aciona atendimento oficial. Se houver risco imediato, ligue 193 ou 199. O que aconteceu?';
const failure = 'Tive um problema para continuar. Se precisar, use o registro por texto na tela.';
const instructions = `Você é o atendente do SOS Live em uma demonstração. Fale português brasileiro, brevemente, com uma pergunta de cada vez.
Colete o fato relatado, o local, o número de pessoas e a necessidade de ajuda para se deslocar. Aproveite tudo que a pessoa já informou.
Faça no máximo uma pergunta por resposta. Peça um dado por vez, espere a resposta e só então faça a próxima pergunta. Evite listas de perguntas e opções em sequência.
Assim que ouvir o que aconteceu e antes de perguntar o local, chame consultarLocalizacao com decision=consultar. Faça o mesmo quando a pessoa disser que marcou o ponto ou pedir para usar a localização. Não leia as coordenadas em voz alta.
Se mapaEnviado=true e confirmado=false e a pessoa não indicou outro local, diga apenas “Marquei sua localização no mapa. É aí que aconteceu?”. Aguarde a resposta. Com um sim claro, chame consultarLocalizacao com decision=confirmar. Se a pessoa disser que foi em outro lugar, chame com decision=descartar. Nunca afirme que mostrou ou confirmou um ponto sem a ferramenta retornar sucesso.
Se confirmado=true, o local está resolvido. Passe imediatamente à próxima informação da ocorrência. NÃO pergunte bairro, rua, número, município, UF ou ponto de referência depois de confirmar o ponto. Isso vale mesmo se todos os dados textuais estiverem vazios. Se a pessoa corrigir o local espontaneamente, descarte o ponto e retome a localização.
Só quando não houver ponto disponível ou ele tiver sido descartado, pergunte o bairro e depois a referência se faltarem. Peça cidade ou UF só se ainda forem necessários para situar o relato.
No rascunho, aproveite o município e a UF do ponto confirmado quando disponíveis. Se a pessoa mencionou bairro, rua, número ou referência, guarde no campo address. Se houver apenas dados de endereço sugeridos pelo mapa, descreva-os como sugestão no resumo e mantenha o ponto como localização principal.
“Bairro” sozinho descreve o local, não o fato. Nesse caso, pergunte primeiro o que aconteceu. Se a pessoa disser “eu, meu padrasto e minha mãe”, registre três pessoas e diga apenas “três pessoas” no resumo.
Pergunte quando houver ambiguidade. Aceite que a pessoa não saiba. Não peça nomes, telefone, documentos ou detalhes médicos.
Use somente fatos informados pela pessoa. Não invente dados ou coordenadas. Preserve os dados desconhecidos como vazios.
Não estime gravidade ou prioridade, não prometa resgate. Em perigo imediato, oriente ligar 193 ou 199 antes de continuar.
Quando tiver um relato, chame prepararRelato, leia o resumo em voz alta e peça para a pessoa revisar e tocar em Confirmar e enviar na tela.
Se houver uma correção verbal antes do envio, chame prepararRelato de novo com o relato completo corrigido e leia o novo resumo.
Uma confirmação falada permite seguir para a confirmação na tela. Ela não salva o relato.
Quando a pessoa perguntar se foi salvo ou receber uma indicação de confirmação na tela, chame consultarRegistro.
Só diga que foi registrado se consultarRegistro retornar registrado=true. Oriente a pessoa a conferir o protocolo na tela.`;

const insightGreeting = 'Olá. Posso consultar os relatos, mover o mapa e abrir ocorrências. O que você quer ver na Central?';
const insightInstructions = `Você é o assistente de consulta da Central do SOS Live. Fale em português brasileiro e com frases breves.
Consulte a ferramenta consultarOcorrencias antes de dar qualquer contagem, ranking ou exemplo. Use município, estado ou macrorregião brasileira, incluindo buscas nacionais.
Quando o operador pedir para mostrar, aproximar ou afastar o mapa, chame moverMapa. Para aproximar ou afastar a vista atual sem mudar de lugar, deixe município e região vazios. Para enquadrar um local, informe o município e a UF quando souber, ou uma região brasileira.
Quando o operador pedir para abrir uma ocorrência, chame abrirOcorrencia com o protocolo. Se ele descreveu a ocorrência sem citar protocolo, consulte os relatos recentes no recorte informado, use o protocolo quando houver uma correspondência clara e peça esclarecimento quando houver dúvida. Pode chamar as duas ferramentas em sequência se o pedido combinar mapa e abertura.
Confirme verbalmente o envio do comando apenas quando a ferramenta retornar enviado=true. A Central mostra quando a ação foi aplicada. Ferramentas de navegação não alteram o registro.
Se o município for ambíguo, pergunte a UF. Use sete dias quando o operador não citar período e diga qual período foi usado.
Entenda principais ocorrências como as categorias mais frequentes nos registros, não como gravidade. Separe relatos verificados dos pendentes.
Diga que os resultados se referem aos relatos da base SOS Live. Em recortes sem registros, diga isso sem inferir que não houve desastres.
Não invente ocorrências, não leia endereço ou dados pessoais e não dê ordens operacionais. Este ambiente pode conter registros de demonstração.`;

export function voiceConfig() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!appId || !appCertificate || !publicUrl?.startsWith('https://')) {
    throw new InputError('Voz indisponível. Configure o projeto Agora e o endereço HTTPS ou use o relato por texto.', 503);
  }
  return { appId, appCertificate, publicUrl };
}

export function audioToken(uid: string, channel: string) {
  const { appId, appCertificate } = voiceConfig();
  return { appId, token: RtcTokenBuilder.buildTokenWithRtm(
    appId, appCertificate, channel, uid, RtcRole.PUBLISHER, lifetime, lifetime,
  ), uid, channel };
}

export function newUid() {
  return String(randomInt(1_000_000, 2_000_000_000));
}

function client() {
  const { appId, appCertificate } = voiceConfig();
  return new AgoraClient({ area: Area.US, appId, appCertificate });
}

class PortugueseVoice extends MiniMaxTTS {
  toConfig() {
    const config = super.toConfig();
    Object.assign(config.params, { language_boost: 'Portuguese' });
    return config;
  }
}

function reportTools(id: string): LlmTool[] {
  const { publicUrl } = voiceConfig();
  const headers = { Authorization: `Bearer ${toolToken(id)}`, 'Content-Type': 'application/json' };
  return [
    {
      type: 'function',
      function: {
        name: 'prepararRelato',
        description: 'Prepara ou corrige o resumo para a confirmação na tela. Envie todos os campos em cada chamada.',
        parameters: {
          type: 'object', additionalProperties: false,
          required: ['category', 'description', 'city', 'uf', 'address', 'people', 'mobility'],
          properties: {
            category: { type: 'string', enum: Object.keys(categories), description: 'flood=alagamento, road=via interditada, power=energia, shelter=abrigo, infrastructure=infraestrutura, other=outros' },
            description: { type: 'string', description: 'Resumo factual do que a pessoa declarou' },
            city: { type: 'string', description: 'Município informado ou vazio' },
            uf: { type: 'string', description: 'Sigla da UF informada ou confirmada, ou vazio se desconhecida' },
            address: { type: 'string', description: 'Bairro e ponto de referência informados, mais rua e número quando houver. Preserve cada detalhe disponível.' },
            people: { type: 'string', description: 'Número de pessoas em dígitos ou vazio se desconhecido' },
            mobility: { type: 'string', enum: ['sim', 'não', ''], description: 'Necessidade de ajuda de mobilidade. Vazio se desconhecida' },
          },
        },
      },
      server: { method: 'POST', url: `${publicUrl}/api/agent/tools/draft`, headers, timeout_ms: 8000,
        body: { id, category: '{{args.category}}', description: '{{args.description}}', city: '{{args.city}}', uf: '{{args.uf}}',
          address: '{{args.address}}', people: '{{args.people}}', mobility: '{{args.mobility}}' } },
    },
    {
      type: 'function',
      function: { name: 'consultarLocalizacao', description: 'Consulta o ponto do mapa. Confirma ou descarta o ponto após a resposta do cidadão.',
        parameters: { type: 'object', properties: {
          decision: { type: 'string', enum: ['consultar', 'confirmar', 'descartar'], description: 'Use consultar por padrão. Use confirmar somente após um sim explícito ao ponto sugerido.' },
        }, required: ['decision'], additionalProperties: false } },
      server: { method: 'POST', url: `${publicUrl}/api/agent/tools/location`, headers, body: { id, decision: '{{args.decision}}' }, timeout_ms: 5000 },
    },
    {
      type: 'function',
      function: { name: 'consultarRegistro', description: 'Confere se o cidadão confirmou e se o servidor salvou o relato.',
        parameters: { type: 'object', properties: {}, additionalProperties: false } },
      server: { method: 'POST', url: `${publicUrl}/api/agent/tools/receipt`, headers, body: { id }, timeout_ms: 5000 },
    },
  ];
}

function insightsTools(id: string): LlmTool[] {
  const { publicUrl } = voiceConfig();
  const headers = { Authorization: `Bearer ${toolToken(id)}`, 'Content-Type': 'application/json' };
  return [{
    type: 'function',
    function: {
      name: 'consultarOcorrencias',
      description: 'Retorna contagens por categoria e verificação, com exemplos recentes, usando somente a base SOS Live.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['city', 'region', 'days'],
        properties: {
          city: { type: 'string', description: 'Nome do município ou vazio se a pergunta for por estado, macrorregião ou Brasil.' },
          region: { type: 'string', description: 'UF ou estado, Norte, Nordeste, Centro-Oeste, Sudeste, Sul ou Brasil. Use vazio se só souber o município.' },
          days: { type: 'integer', minimum: 1, maximum: 365, description: 'Dias até agora. Use 7 se não foi informado.' },
        },
      },
    },
    server: {
      method: 'POST', url: `${publicUrl}/api/agent/tools/insights`,
      headers,
      body: { id, city: '{{args.city}}', region: '{{args.region}}', days: '{{args.days}}' }, timeout_ms: 8000,
    },
  }, {
    type: 'function',
    function: {
      name: 'moverMapa',
      description: 'Controla o mapa visível da Central. Mostra Brasil, uma região, estado ou município, ou altera o zoom atual.',
      parameters: { type: 'object', additionalProperties: false, required: ['action', 'city', 'region'],
        properties: {
          action: { type: 'string', enum: ['localizar', 'aproximar', 'afastar'] },
          city: { type: 'string', description: 'Nome do município, ou vazio' },
          region: { type: 'string', description: 'UF, estado, macrorregião ou Brasil. Vazio para zoom na vista atual ou município sem UF.' },
        },
      },
    },
    server: { method: 'POST', url: `${publicUrl}/api/agent/tools/move-map`, headers, timeout_ms: 5000,
      body: { id, callId: '{{tool_call_id}}', action: '{{args.action}}', city: '{{args.city}}', region: '{{args.region}}' } },
  }, {
    type: 'function',
    function: {
      name: 'abrirOcorrencia',
      description: 'Seleciona o relato pelo protocolo e abre detalhes e evidências no painel direito da Central.',
      parameters: { type: 'object', additionalProperties: false, required: ['protocol'],
        properties: { protocol: { type: 'string', description: 'Protocolo SOS da ocorrência escolhida pelo operador' } },
      },
    },
    server: { method: 'POST', url: `${publicUrl}/api/agent/tools/open-incident`, headers, timeout_ms: 5000,
      body: { id, callId: '{{tool_call_id}}', protocol: '{{args.protocol}}' } },
  }];
}

export function startAgent(id: string, channel: string, uid: string, purpose: VoicePurpose = 'report') {
  const consulting = purpose === 'insights';
  const opening = consulting ? insightGreeting : greeting;
  const agent = new Agent({
    client: client(), instructions: consulting ? insightInstructions : instructions, greeting: opening, failureMessage: failure,
    turnDetection: { config: {
      speech_threshold: 0.5,
      start_of_speech: { mode: 'vad', vad_config: { interrupt_duration_ms: 160, prefix_padding_ms: 300 } },
      end_of_speech: { mode: 'vad', vad_config: { silence_duration_ms: 480 } },
    } },
    advancedFeatures: { enable_rtm: true, enable_tools: true },
    parameters: { audio_scenario: 'chorus', data_channel: 'rtm', enable_error_message: true, enable_metrics: true },
  }).withStt(new DeepgramSTT({ model: 'nova-3', language: 'pt-BR' }))
    .withLlm(new OpenAI({ model: 'gpt-4.1-mini', greetingMessage: opening, failureMessage: failure,
      maxHistory: 40, params: { max_tokens: 768, temperature: 0.3 }, tools: consulting ? insightsTools(id) : reportTools(id) }))
    .withTts(new PortugueseVoice({ model: 'speech_2_6_turbo', voiceId: 'Portuguese_SereneWoman' }));
  return agent.createSession({ channel, agentUid: String(DEFAULT_AGENT_UID), remoteUids: [uid],
    idleTimeout: 30, expiresIn: ExpiresIn.seconds(lifetime), debug: false }).start();
}

export async function stopAgent(agentId: string) {
  try {
    await client().stopAgent(agentId);
  } catch {
    console.warn('[sos-live] Agora não confirmou o encerramento da voz.');
  }
}

export async function tellAgentConfirmed(agentId: string, channel: string) {
  try {
    const { appId, appCertificate } = voiceConfig();
    const token = generateConvoAIToken({ appId, appCertificate, channelName: channel, uid: DEFAULT_AGENT_UID, tokenExpire: 60 });
    await client().agentManagement.agentThink({
      appid: appId, agentId, text: 'A confirmação na tela terminou. Consulte consultarRegistro antes de responder.',
      on_speaking_action: 'append', on_thinking_action: 'append', on_listening_action: 'inject',
    }, {
      headers: { Authorization: `agora token=${token}` }, timeoutInSeconds: 5, maxRetries: 0,
    });
  } catch {
    console.warn('[sos-live] Agora não confirmou o aviso de registro.');
  }
}

export function operatorToken() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const certificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  const channel = operatorChannel();
  if (!appId || !certificate || !channel || !process.env.AGORA_REST_KEY || !process.env.AGORA_REST_SECRET) return null;
  const uid = newUid();
  return { appId, uid, channel, token: RtcTokenBuilder.buildTokenWithRtm(
    appId, certificate, channel, uid, RtcRole.SUBSCRIBER, 3600, 3600,
  ) };
}

export async function signalChange() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const key = process.env.AGORA_REST_KEY;
  const secret = process.env.AGORA_REST_SECRET;
  const channel = operatorChannel();
  if (!appId || !key || !secret || !channel) return;
  try {
    const response = await fetch(`https://api.agora.io/dev/v2/project/${appId}/rtm/users/sos-events/channel_messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_name: channel, enable_historical_messaging: false, payload: 'incidents-changed' }),
      signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) console.warn('[sos-live] Agora Signaling retornou', response.status);
  } catch {
    console.warn('[sos-live] Agora Signaling indisponível.');
  }
}
