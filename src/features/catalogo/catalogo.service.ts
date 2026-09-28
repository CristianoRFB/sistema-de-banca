import { catalogoRepository } from './catalogo.repository';
import type { FiltrosCatalogo, ProdutoCatalogo } from './catalogo.types';

export async function buscarCatalogo(filtros: FiltrosCatalogo) {
  const page = await catalogoRepository.list(filtros);
  return page.itens;
}

export async function buscarProduto(itemReparteId: string): Promise<ProdutoCatalogo> {
  return catalogoRepository.get(itemReparteId);
}

export function pesquisarLocalmente(itens: ProdutoCatalogo[], filtros: FiltrosCatalogo) {
  const query = normalizar(filtros.busca);
  return itens.filter((item) => {
    const text = normalizar([item.titulo, item.nomeOriginal, item.volume, item.editora].filter(Boolean).join(' '));
    const searchMatch = !query || text.includes(query);
    const typeMatch = !filtros.tipo || filtros.tipo === 'TODOS' || item.tipo === filtros.tipo;
    const stockMatch = filtros.disponibilidade !== 'ULTIMAS_UNIDADES'
      || (item.quantidadeDisponivel !== null && item.quantidadeDisponivel > 0 && item.quantidadeDisponivel <= 3);
    const availableMatch = filtros.disponibilidade !== 'DISPONIVEIS'
      || (item.quantidadeDisponivel !== null && item.quantidadeDisponivel > 0);
    return searchMatch && typeMatch && stockMatch && availableMatch;
  });
}

export function normalizar(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
