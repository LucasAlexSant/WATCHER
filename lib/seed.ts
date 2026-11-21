import { type Category, type Incident, type UF } from './incidents';
import { municipality, municipalityPoint } from './geography';

const examples: Array<[Category, string, string, number | null, UF?]> = [
  ['flood', 'Canoas', 'Água subindo nas casas perto da praça do bairro.', 3],
  ['road', 'Porto Alegre', 'Pista bloqueada por água perto de um cruzamento.', null],
  ['shelter', 'Eldorado do Sul', 'Família procura local de acolhimento após sair de casa.', 4],
  ['power', 'Guaíba', 'Trecho do bairro relata interrupção de energia.', null],
  ['flood', 'São Leopoldo', 'Moradores informam que a água entrou na garagem.', 2],
  ['infrastructure', 'Novo Hamburgo', 'Moradores relatam danos em uma passagem de pedestres.', null],
  ['flood', 'Esteio', 'Quintais com água acumulada após a chuva.', null],
  ['road', 'Canoas', 'Acesso de veículos interrompido perto de uma ponte.', null],
  ['power', 'Porto Alegre', 'Residências estão sem energia em um quarteirão.', null],
  ['shelter', 'São Leopoldo', 'Dois moradores precisam de hospedagem temporária.', 2],
  ['flood', 'Guaíba', 'Parte de uma rua residencial está alagada.', null],
  ['infrastructure', 'Eldorado do Sul', 'Estrutura de uma calçada cedeu perto do arroio.', null],
  ['road', 'Novo Hamburgo', 'Galhos e água impedem a passagem de veículos.', null],
  ['flood', 'Porto Alegre', 'Houve entrada de água em uma residência térrea.', 2],
  ['shelter', 'Esteio', 'Moradores buscam acolhimento após desocupar a casa.', 3],
  ['power', 'São Leopoldo', 'Iluminação pública interrompida em parte do bairro.', null],
  ['road', 'Eldorado do Sul', 'Acesso por rua lateral está bloqueado.', null],
  ['flood', 'Novo Hamburgo', 'Água alcançou o pátio de uma casa.', null],
  ['flood', 'Canoas', 'Alagamento nas residências junto à praça do bairro.', 3],
  ['road', 'Canoas', 'Via junto à ponte está fechada para carros.', null],
  ['flood', 'Manaus', 'Água cobriu o acesso a uma rua residencial.', null, 'AM'],
  ['infrastructure', 'Belém', 'Ponte de pedestres com danos após a chuva.', null, 'PA'],
  ['flood', 'Recife', 'Água acumulada nas proximidades de uma praça.', 4, 'PE'],
  ['road', 'Salvador', 'Via bloqueada por queda de árvore.', null, 'BA'],
  ['shelter', 'Goiânia', 'Moradores procuram abrigo temporário.', 3, 'GO'],
  ['power', 'Brasília', 'Moradias com interrupção de energia após chuva.', null, 'DF'],
  ['flood', 'São Paulo', 'Alagamento em uma via de acesso residencial.', null, 'SP'],
  ['road', 'Belo Horizonte', 'Moradores relataram um trecho de via interditado.', null, 'MG'],
  ['flood', 'Rio de Janeiro', 'Água acumulada em uma passagem pública.', 2, 'RJ'],
  ['infrastructure', 'Florianópolis', 'Calçada danificada após o temporal.', null, 'SC'],
];

export function examplesAt(time: number): Incident[] {
  return examples.map(([category, city, description, people, uf = 'RS'], index) => {
    const createdAt = new Date(time - (index + 1) * 180_000).toISOString();
    return {
      id: `05110000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      category, city, uf, description, people, address: null, mobility: null, coordinates: municipalityPoint(municipality(city, uf)),
      source: 'simulation', verification: index % 6 === 1 ? 'verified' : index % 4 === 2 ? 'reviewing' : 'unverified',
      operational: 'received', createdAt, updatedAt: createdAt, version: 1,
    };
  });
}
