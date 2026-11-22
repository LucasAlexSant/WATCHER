# SOS Live · Monitores

Painel local com seis monitores de pagamentos e contas. As métricas são simuladas no navegador, atualizadas a cada dois segundos.

## Configuração

Com Node.js 22 ou mais recente, crie um arquivo `.env.local` ignorado pelo Git com estas variáveis:

```dotenv
SUPABASE_URL=
SUPABASE_SECRET_KEY=
TYPESAFE_API_KEY=
```

A integração usa a Data API do Supabase no servidor. A chave pública e a URL JWKS não são necessárias para essa rota local.

```sh
npm ci
npm run dev
```

Abra http://localhost:3002 e clique em **Simular incidente**.

## Fluxo

- O botão registra um alerta em `public.alerts` vinculado ao serviço `pix-demo`, criado na primeira simulação. O cadastro fica marcado como desabilitado para coleta automática.
- A demo apresenta o PIX com falha há três minutos. A triagem começa assim que o alerta é registrado.
- O servidor consulta os incidentes dos 15 minutos que antecedem a triagem, além das verificações de saúde e do último deploy do PIX. A demonstração acrescenta ocorrências fictícias relacionadas, independentes e ambíguas. O painel distingue dados de demonstração dos metadados reais.
- Jev avalia cada ocorrência como correlacionada, descartada ou inconclusiva. Em uma segunda consulta, o modelo usa as avaliações e as métricas para escolher P1 ou P2. As comparações e probabilidades ficam na triagem e no incidente. Sem resposta do Jev, o alerta fica pendente e nenhum incidente é gravado.
- Encerrar a simulação fecha o alerta e resolve o incidente se ele já tiver sido registrado.

A rota tem acesso elevado ao banco e só funciona em desenvolvimento local. Para implantar em um servidor público, adicione autenticação e controle de acesso antes de habilitar as escritas.

## Acionamento por voz

Depois da triagem, clique em **Gerar acionamento**. Para usar o último incidente triado mesmo após recarregar a página, clique em **Acionar último incidente PIX**. O painel busca o nome no plantão de `pix-demo` e oferece o Plantão de Pagamentos quando não há responsável individual cadastrado. Copie o link e encaminhe pelo canal da equipe.

O link é assinado, vale por 30 minutos e abre uma chamada em outra aba. Ao **Atender**, permita o microfone. O assistente da Agora apresenta o contexto em português. A chamada usa um token de dez minutos e o navegador encerra a sessão antes do vencimento. O fluxo de voz segue o `agora-agent-demo`, com o mesmo projeto Agora, token RTC + RTM, Deepgram Nova-3, GPT-4o mini e MiniMax. O briefing, o reconhecimento e a voz são em português.

O servidor precisa de `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_AGORA_APP_CERTIFICATE` e `CALL_SIGNING_SECRET` (segredo aleatório com pelo menos 32 caracteres). Por padrão, o link aponta para o localhost. Para outro dispositivo, disponibilize a página e a API da chamada sob HTTPS e configure o mesmo endereço em `CALL_PUBLIC_ORIGIN`.

A aba da chamada mostra a transcrição ao vivo das duas vozes usando o mesmo Agora Voice AI Toolkit e RTM do demo. A transcrição fica na aba até recarregar ou fechar a página. No link operacional, apenas as falas concluídas do engenheiro são registradas no histórico como relatos. As falas do assistente e do link de consulta ficam na aba.

## War room e pós-mortem

- Use **Gerar acionamento** para o plantão ou **Link para o CTO** para uma conversa de consulta. Um link novo para o mesmo incidente carrega o estado salvo. O link de consulta não grava relatos e só recebe a ferramenta de leitura.
- O contexto separa alertas do PIX, sinais simulados correlacionados, decisão de prioridade e histórico com apenas metadados. O painel atualiza o contexto periodicamente. O agente fala em português e distingue fatos, relatos e hipóteses.
- No Supabase, `public.incident_events` guarda entradas anexadas ao incidente com `payload.namespace = "sos-warroom"`. O tipo `engineer_report` preserva o relato da operação. O tipo `checkpoint` guarda o resumo do agente, a decisão, o responsável e o próximo passo quando informados. Esses registros servem de insumo para um futuro pós-mortem.
- Para ativar as ferramentas nativas da Agora, configure `WARROOM_TOOLS_ORIGIN` apontando para uma origem HTTPS acessível pela Agora que encaminhe `POST /api/warroom/tools`. O servidor também aceita `CALL_PUBLIC_ORIGIN` se o endpoint estiver exposto nessa mesma origem. Cada ferramenta usa autorização assinada, temporária e restrita ao incidente. O agente busca o contexto novamente sempre que a informação atual for necessária e salva checkpoints após mudanças operacionais confirmadas.
- Em localhost, o servidor entrega o contexto ao iniciar cada chamada. O painel atualiza o histórico e salva relatos operacionais pelo navegador. Os checkpoints estruturados pelo agente exigem o endpoint HTTPS.

### Resumos periódicos e mudanças

- Em chamadas operacionais, a cada dois minutos o painel pede à LLM da Agora um breve resumo falado. Quando a resposta completa chega pela transcrição, o servidor grava estado, planejamento e horário em `incident_events`. A interface indica quando um resumo ficou pendente. O link do CTO continua somente para consulta.
- A tabela reúne cinco GMUDs fictícias e os metadados de deploys relevantes do Supabase na janela anterior ao alerta. O Jev classifica as mudanças, ordenadas pela probabilidade de correlação. A análise e os cards compartilhados são guardados no incidente para quem entrar depois.
- A área da transcrição inclui cards que abrem um popover. Use **Compartilhar** na tabela para destacar uma GMUD na transcrição. Com a origem HTTPS configurada, as tools da Agora também podem analisar e compartilhar essas mudanças durante a chamada.
