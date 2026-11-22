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

O link é assinado, vale por 30 minutos e abre uma chamada em outra aba. Ao **Atender**, permita o microfone. O assistente da Agora apresenta o contexto em português. A chamada tem duração máxima configurada de dez minutos.

O servidor precisa de `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_AGORA_APP_CERTIFICATE` e `CALL_SIGNING_SECRET` (segredo aleatório com pelo menos 32 caracteres). Por padrão, o link aponta para o localhost. Para outro dispositivo, disponibilize a página e a API da chamada sob HTTPS e configure o mesmo endereço em `CALL_PUBLIC_ORIGIN`.
