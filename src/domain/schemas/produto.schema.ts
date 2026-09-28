import type { Produto } from "../entities/Produto";
import { TipoProduto } from "../enums/TipoProduto";
import { boolean, createSchema, date, enumValue, nullableString, record, string } from "./schema-utils";

function parseProduto(input: unknown): Produto {
  const value = record(input);
  return {
    id: string(value.id, "id"),
    codigo: nullableString(value.codigo, "codigo"),
    titulo: string(value.titulo, "titulo"),
    tituloNormalizado: string(value.tituloNormalizado, "tituloNormalizado"),
    nomeOriginal: nullableString(value.nomeOriginal, "nomeOriginal"),
    volume: nullableString(value.volume, "volume"),
    editora: nullableString(value.editora, "editora"),
    tipo: enumValue(TipoProduto, value.tipo, "tipo"),
    isbn: nullableString(value.isbn, "isbn"),
    ativo: boolean(value.ativo, "ativo"),
    criadoEm: date(value.criadoEm, "criadoEm"),
    atualizadoEm: date(value.atualizadoEm, "atualizadoEm"),
  };
}

export const produtoSchema = createSchema(parseProduto);
export const parseProdutoSchema = produtoSchema.parse;