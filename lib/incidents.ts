export const categories = {
  flood: 'Alagamento',
  road: 'Via interditada',
  power: 'Falta de energia',
  shelter: 'Pedido de abrigo',
  infrastructure: 'Infraestrutura',
  other: 'Outro',
} as const;

export const verificationLabels = {
  unverified: 'Não verificado',
  reviewing: 'Em análise',
  verified: 'Verificado',
  dismissed: 'Descartado',
} as const;

export const operationalLabels = {
  received: 'Recebido',
  monitoring: 'Em acompanhamento',
  referred: 'Encaminhado',
  closed: 'Encerrado',
} as const;

export type Category = keyof typeof categories;
export type VerificationStatus = keyof typeof verificationLabels;
export type OperationalStatus = keyof typeof operationalLabels;
export type Coordinates = { latitude: number; longitude: number; precision: 'approximate' | 'confirmed' };

export const states = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia',
  RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
} as const;

export type UF = keyof typeof states;
export const regions: Record<string, readonly UF[]> = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC'],
};

export type DeviceLocation = {
  coordinates: Coordinates; accuracy: number; city: string | null; uf: UF | null; confirmedForIncident?: boolean;
  street?: string | null; neighborhood?: string | null; houseNumber?: string | null;
};
export type VoiceMapEvent = {
  id: string;
  kind: 'shown' | 'confirmed' | 'discarded';
  point: Coordinates;
};
export type PhotoEvidence = { id: string; createdAt: string };
export type VoicePurpose = 'report' | 'insights';

export type Report = {
  category: Category;
  description: string;
  city: string | null;
  uf?: UF | null;
  address: string | null;
  people: number | null;
  mobility: boolean | null;
  coordinates: Coordinates | null;
};

export type Incident = Report & {
  id: string;
  source: 'voice' | 'text' | 'simulation';
  verification: VerificationStatus;
  operational: OperationalStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type IncidentEvent = {
  actor: string;
  reason: string;
  before: Incident | null;
  after: Incident;
  at: string;
};

export type VoiceDraft = { report: Report; revision: number };

export const normalizeCity = (city: string) =>
  city.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('pt-BR');

export function protocol(id: string) {
  return `SOS-${id.replaceAll('-', '').slice(-10).toUpperCase()}`;
}
