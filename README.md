# SOS Live · Monitores

Uma versão independente do SOS Live para demonstrar o monitoramento de seis serviços de pagamentos e contas. A tela atualiza as métricas a cada dois segundos e mantém as últimas 24 leituras.

**Simular incidente** reduz a aprovação do PIX, aumenta a latência do gateway e acumula pendências na fila de conciliação. Os outros três serviços continuam operacionais. **Encerrar simulação** restaura as métricas, mantendo o histórico recente no gráfico.

Os dados são gerados no navegador. O painel não precisa de banco de dados, credenciais ou APIs externas.

## Executar

Com Node.js 22 ou mais recente:

```sh
npm ci
npm run dev -- --port 3002
```

Abra http://localhost:3002.
