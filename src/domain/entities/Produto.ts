import type { TipoProduto } from "../enums/TipoProduto";

export interface Produto {
  id: string;
  codigo: string | null;
  titulo: string;
  tituloNormalizado: string;
  nomeOriginal: string | null;
  volume: string | null;
  editora: string | null;
  tipo: TipoProduto;
  isbn: string | null;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}