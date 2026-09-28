export interface ItemRecolhimento {
  id: string;
  recolhimentoId: string;
  itemReparteId: string;
  produtoId: string;
  quantidadeEsperada: number;
  quantidadeEncontrada: number | null;
  quantidadeDevolvida: number | null;
  divergente: boolean;
  observacao: string | null;
}