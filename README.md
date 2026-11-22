# WATCHER · Monitores

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

A aba da chamada mostra a transcrição ao vivo das duas vozes usando o mesmo Agora Voice AI Toolkit e RTM do demo. A transcrição fica na aba até recarregar ou fechar a página. No link operacional, as falas concluídas do engenheiro e do assistente ficam no histórico com autoria separada. O link de consulta do CTO não grava a conversa.

## War room e pós-mortem

- Use **Gerar acionamento** para o plantão ou **Link para o CTO** para uma conversa de consulta. Um link novo para o mesmo incidente carrega o estado salvo. O link de consulta não grava relatos e só recebe a ferramenta de leitura.
- O contexto separa alertas do PIX, sinais simulados correlacionados, decisão de prioridade e histórico com apenas metadados. O painel atualiza o contexto periodicamente. O agente fala em português e distingue fatos, relatos e hipóteses.
- No Supabase, `public.incident_events` guarda entradas anexadas ao incidente com `payload.namespace = "sos-warroom"`. O tipo `engineer_report` preserva o relato da operação. O tipo `checkpoint` guarda o resumo do agente, a decisão, o responsável e o próximo passo quando informados. Esses registros servem de insumo para um futuro pós-mortem.
- Para ativar as ferramentas nativas da Agora, configure `WARROOM_TOOLS_ORIGIN` apontando para uma origem HTTPS acessível pela Agora que encaminhe `POST /api/warroom/tools`. O servidor também aceita `CALL_PUBLIC_ORIGIN` se o endpoint estiver exposto nessa mesma origem. Cada ferramenta usa autorização assinada, temporária e restrita ao incidente. O agente busca o contexto novamente sempre que a informação atual for necessária e salva checkpoints após mudanças operacionais confirmadas.
- Em localhost, o servidor entrega o contexto ao iniciar cada chamada. O painel atualiza o histórico e salva relatos operacionais pelo navegador. Os checkpoints estruturados pelo agente exigem o endpoint HTTPS.

### Resumos periódicos e mudanças

- Em chamadas operacionais, o NeuraLake consolida em segundo plano os relatos novos a cada dois minutos e após o encerramento. Use **Atualizar resumo** para consolidar imediatamente. O Supabase guarda o horário, o impacto, as decisões, os próximos passos, responsáveis e pendências para o pós-mortem. Relatos já consolidados não são reenviados.
- A análise reúne cinco GMUDs fictícias e os metadados de deploys relevantes do Supabase na janela anterior ao alerta. O Jev classifica as mudanças, ordenadas pela probabilidade de correlação. A análise e os cards compartilhados são guardados no incidente.
- A transcrição inclui cards de incidentes e mudanças com detalhes. Com a origem HTTPS configurada, as ferramentas da Agora também podem analisar e compartilhar mudanças durante a chamada.

## NeuraLake

Configure `NEURALAKE_API_KEY` no `.env.local` do servidor. A consolidação usa a capacidade `text` e registra versões em `incident_events`. O agente operacional continua usando o modelo de voz da Agora. O **Link para o CTO** inicia um copiloto independente e somente de consulta. Se o NeuraLake falhar, o último estado salvo fica disponível e os relatos pendentes podem ser processados na próxima tentativa.

## Lista de war rooms

A aba **War rooms** lista os incidentes simulados em andamento e resolvidos, com prioridade, último resumo do NeuraLake e próximo passo. **Acompanhar com agente do CTO** abre o briefing em outra guia. O painel local gera um link de consulta da lista que expira em uma hora. Para abrir em outro dispositivo, configure `CALL_PUBLIC_ORIGIN` com a origem HTTPS acessível ao destinatário.

**Simular incidente** reserva uma guia no clique e abre a chamada do plantão quando a triagem termina. Use **Atender** para habilitar a voz. Se o navegador bloquear a abertura automática, use **Abrir chamada do plantão** no painel.

Na chamada, a transcrição ocupa a área principal. Peça um contexto breve e, se quiser aprofundar, pergunte quais GMUDs podem estar relacionadas. O agente pode sugerir avaliar um rollback, mas a decisão e a execução ficam com o plantão. Dizer **vamos terminar** encerra a chamada depois da despedida. O NeuraLake consolida os relatos após uma pausa curta e após o desligamento. A conclusão do rollback é registrada como relato do plantão, e a recuperação depende de confirmação.

O resumo é cumulativo. O NeuraLake recebe a última versão e acrescenta os trechos novos da chamada. Achados, decisões e ações anteriores continuam no histórico quando entram falas sem informação nova. O estágio do rollback relatado pelo plantão aparece separado do diagnóstico e pode atualizar o agente do CTO antes da próxima consolidação.
