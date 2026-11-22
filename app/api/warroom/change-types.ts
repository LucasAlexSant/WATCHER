export type ChangeCandidate = {
  id: string;
  at: string;
  title: string;
  service: string;
  version: string;
  detail: string;
  source: 'demo' | 'supabase';
};

export type ChangeReview = ChangeCandidate & {
  label: 'related' | 'unrelated' | 'uncertain';
  probability: number;
  relatedProbability: number;
};

const examples = [
  ['GMUD-1042', -8, 'Timeout de confirmação SPI', 'Gateway PIX', 'spi-adapter 2.8.0', 'Reduziu de 3 s para 800 ms o limite de espera da confirmação SPI. A falha começa com expiração na confirmação.'],
  ['GMUD-1041', -6, 'Concorrência da conciliação', 'Conciliação', 'reconcile-worker 1.14.2', 'Reduziu de 12 para 3 os workers da fila de confirmações PIX. Pode contribuir para o acúmulo; não explica sozinha o timeout SPI.'],
  ['GMUD-1040', -5, 'Ampliação do cache de saldo', 'API de contas', 'accounts 3.4.1', 'Alterou o cache de leitura de saldo. Sem dependência SPI confirmada.'],
  ['GMUD-1039', -4, 'Novo layout do PDF', 'Boletos', 'billing-pdf 1.9.0', 'Mudou apenas a renderização de PDF. Não toca emissão ou pagamentos.'],
  ['GMUD-1038', -2, 'Fila de marketing', 'Comunicação', 'mailer 2.1.0', 'Alterou o canal de envio de campanhas. Sem conexão com pagamentos.'],
] as const;

export function demoChanges(end: string): ChangeCandidate[] {
  const anchor = Date.parse(end);
  return examples.map(([id, minutes, title, service, version, detail]) => ({
    id, at: new Date(anchor + minutes * 60000).toISOString(), title, service, version, detail, source: 'demo',
  }));
}
