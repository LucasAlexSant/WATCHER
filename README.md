# SOS Live

MVP de demonstração do Unmute by Agora. Recebe relatos fictícios por voz ou texto, prepara um resumo para confirmação do cidadão e envia a ocorrência para revisão na central de operações.

Baseado no checkout vizinho `voice-agent-nextjs`. A integração reaproveita o cliente RTC, a transcrição via RTM, o Agora Agent Toolkit/UIKit e a configuração de voz gerenciada pelo SDK `agora-agents`.

## Iniciar localmente

Use Node 22 ou mais recente e pnpm.

```powershell
Set-Location D:/workspace/agora/sos-live
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

- [Relatar ocorrência](http://127.0.0.1:3000/) abre a entrada por voz e a alternativa por texto.
- [Central de operações](http://127.0.0.1:3000/central) aceita o código local `sos-local` quando o servidor roda em loopback sem túnel.
- [Panorama público](http://127.0.0.1:3000/panorama) mostra totais verificados por município e categoria.

O app carrega 30 relatos fictícios distribuídos pelas cinco regiões e persiste em PostgreSQL embutido (PGlite) em `data/postgres` por padrão. Para Supabase, aplique as migrações de [`supabase`](supabase) em ordem numérica, de 001 a 003, configure `DATABASE_URL` e use `SOS_SEED=1` se quiser a massa de demonstração. Use `SOS_SEED=0` para iniciar sem a carga inicial. [Conexões PostgreSQL no Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)

## Configurar voz da Agora

1. Crie `.env.local` a partir de [env.local.example](env.local.example) e preencha `NEXT_PUBLIC_AGORA_APP_ID` e `NEXT_AGORA_APP_CERTIFICATE` de um projeto com Voice Agent e Signaling habilitados.
2. Defina `SOS_OPERATOR_CODE` e `SOS_SESSION_SECRET` para a central quando houver túnel. Recomenda-se `SOS_VOICE_CODE` ao compartilhar a demonstração.
3. Defina `PUBLIC_URL` com o endereço HTTPS do ambiente ou rode `pnpm tunnel` em um terminal separado com o Cloudflare Tunnel instalado. Para usar outra porta, configure `PORT` nesse terminal. Inicie ou reinicie o servidor após configurar o ambiente.
4. Abra **Por voz**, autorize o microfone e relate um cenário fictício. O agente fala em português, aceita interrupções e gera o resumo por ferramenta HTTPS. Corrija por voz se necessário e toque em **Confirmar e enviar**.

O agente usa Deepgram Nova‑3, GPT‑4.1 mini e MiniMax em português do Brasil, com as credenciais gerenciadas pelo projeto Agora. As ferramentas recebem credenciais de sessão geradas pelo servidor. O navegador envia a revisão exata que o morador confirmou. Um reenvio retorna o mesmo protocolo. [Ferramentas personalizadas da Agora](https://docs.agora.io/en/ai/build/tools/custom-tools)

Em um túnel restrito a callbacks, permita `POST` em `/api/agent/tools/draft`, `/api/agent/tools/receipt`, `/api/agent/tools/location`, `/api/agent/tools/insights`, `/api/agent/tools/move-map` e `/api/agent/tools/open-incident`. A sessão do assistente da Central exige login de operador. Ela usa a mesma configuração da Agora do agente de relato.

## Central, localização e panorama

- A central atualiza automaticamente a cada 1,5 s. Configure `AGORA_REST_KEY` e `AGORA_REST_SECRET` para também emitir sinais de atualização via Agora Signaling. O canal carrega apenas um aviso de atualização, e os registros continuam sendo lidos pela API autenticada. [Publicação de mensagens via Agora](https://docs.agora.io/en/api-reference/api-ref/signaling/channel-message)
- O operador pode corrigir os campos e atualizar a verificação e a situação operacional separadamente, com justificativa e histórico. O acesso de demonstração identifica o operador configurado por `SOS_OPERATOR_NAME`.
- A Central ocupa a altura da janela. O mapa fica à esquerda e o painel à direita pagina os relatos e mostra a primeira foto da ocorrência selecionada. Em telas estreitas, abra a lista pelo botão **Ocorrências** no cabeçalho. **Revisar ocorrência** abre o formulário e as demais evidências.
- **Consultar com a Agora** abre o assistente sem esconder a lista. Experimente “Mostre Recife no mapa”, “Aproxime mais” ou “Abra a ocorrência” seguido do protocolo da Central. O agente também resume as categorias mais frequentes por município, UF, macrorregião ou Brasil. **Por filtros** usa a mesma consulta de dados.
- Cada comando de navegação pertence à sessão de voz que o iniciou. O navegador autenticado lê os comandos na ordem de envio. A ferramenta de abertura verifica o protocolo e a movimentação usa o catálogo territorial.
- Se o navegador já tem permissão, o app busca o GPS automaticamente. Caso contrário, use **Usar minha localização**. Quando a Agora consulta o ponto, o mapa centraliza no marcador e exibe o aviso. Responda por voz se a ocorrência aconteceu ali. Com o ponto confirmado, a conversa segue para os dados da ocorrência. Se aconteceu em outro lugar, diga isso ao agente ou use **Marcar outro ponto**. O envio do resumo continua exigindo confirmação na tela.
- **Anexar fotos** aceita até três imagens em cada relato, pela câmera ou por upload. As imagens são redimensionadas no navegador e salvas junto com o relato confirmado. Abra **Revisar ocorrência** para vê-las na Central autenticada.
- Os mapas usam MapLibre e OpenFreeMap. **Ver Brasil** retorna à visão nacional. O backend consulta a malha municipal do IBGE publicada pela Infra S.A. para identificar o município do ponto. Quando a margem de erro do GPS alcança mais de um município, o app deixa o município em aberto. Configure `GEOAPIFY_API_KEY` no servidor para sugerir rua, bairro e número onde a base tiver cobertura. O app só sugere esses dados para pontos de boa precisão e resultados próximos no mesmo município. [Malha Municipal do IBGE](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html) · [OpenFreeMap](https://openfreemap.org/quick_start/) · [Geoapify](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/)
- O panorama agrega os relatos verificados por município e UF. Dados individuais e fotos ficam na Central.

Para hospedar em Vercel, use o Supabase e um domínio HTTPS em `PUBLIC_URL`. O PGlite foi incluído para desenvolvimento local com um único processo.

## Verificação

```powershell
pnpm run verify
```

O comando roda lint, TypeScript, verificações de confirmação, concorrência, autorização do callback, idempotência, auditoria e panorama com um PostgreSQL em memória, e o build de produção. A chamada ao provedor exige credenciais e pode consumir créditos.

Com voz configurada e servidor acessível, `node --env-file=.env.local scripts/probe-voice.mjs` abre uma sessão faturável, injeta três falas fictícias sem microfone e compara o ponto confirmado no resumo com o registro salvo na Central. A sessão é encerrada ao final. Defina `SOS_PROBE_URL` para testar em outra porta.

Para depurar os callbacks, inicie o servidor com `SOS_DEBUG_AGENT_TOOLS=1` e procure por `[sos-live:agent-tool]` no terminal. O log mostra a ferramenta, o status HTTP, a duração e o resultado resumido de localização, rascunho ou protocolo. Coordenadas, credenciais e texto da conversa ficam fora do log.
