/** Item de catálogo aponta para um lote específico, não apenas para o produto. */
export interface ItemLista {
  id: string;
  listaId: string;
  bancaId: string;
  itemReparteId: string;
  produtoId: string;
  ordem: number;
  tituloExibicao: string;
  precoExibicao: number | null;
  ativo: boolean;
}