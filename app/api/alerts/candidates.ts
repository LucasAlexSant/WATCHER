export type Candidate = {
  at: string;
  title: string;
  signal: string;
  source: 'demo' | 'supabase';
};

export type Comparison = Candidate & { label: 'related' | 'unrelated' | 'uncertain'; probability: number };

const demoEvents = [
  [-10, 'Boleto · geração de PDF', 'Atraso só na renderização do PDF. Emissão e pagamento de boletos normais.'],
  [-6, 'Provedor de comunicação · e-mail', 'Aumento de atrasos em e-mails de marketing. Sem impacto na infraestrutura de pagamentos.'],
  [-3, 'Gateway · confirmação via SPI', 'Timeouts no adaptador SPI que confirma transferências PIX. Outros meios de pagamento respondem normalmente.'],
  [-1, 'Cartões · autorização', 'Aumento de recusas em um emissor de cartões. O tráfego desse emissor usa uma integração independente.'],
  [1, 'Conciliação · fila de confirmações', 'Confirmações PIX pendentes aumentam logo após os timeouts no SPI.'],
  [2, 'API de contas · latência', 'Leituras de saldo ficaram mais lentas. Não há informação sobre dependências em comum.'],
] as const;

export function demoCandidates(openedAt: number, from: number, to: number): Candidate[] {
  return demoEvents.flatMap(([minutes, title, signal]) => {
    const at = openedAt + minutes * 60000;
    return at >= from && at <= to ? [{ at: new Date(at).toISOString(), title, signal, source: 'demo' }] : [];
  });
}
