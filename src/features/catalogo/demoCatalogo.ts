import type { ProdutoCatalogo } from './catalogo.types';

const sampleRows: Array<[string, string]> = [
  ['Agentes das Estações', '01'],
  ['Wistoria', '09'],
  ['Romantic Killer', '01'],
  ['O Paraíso Ilusório', '13'],
  ['Os Filhos da Família Shiunji', '08'],
  ['Mushoku Tensei', '24'],
  ["Tamon's B-Side", '04'],
  ['Centuria', '01'],
  ['On/Off', '03'],
  ['Wind Breaker', '25'],
  ['Colégio Ouran', '01'],
  ['Century Boys', '09'],
];

export const demoCatalogo: ProdutoCatalogo[] = sampleRows.map(([titulo, volume], index) => ({
  id: `amostra-${index + 1}`,
  produtoId: `amostra-produto-${index + 1}`,
  itemReparteId: `amostra-item-${index + 1}`,
  titulo,
  volume,
  tipo: 'MANGA',
  quantidadeDisponivel: null,
  permiteReserva: false,
  demonstracao: true,
}));
