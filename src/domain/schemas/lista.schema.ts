import type { Lista } from "../entities/Lista";
import { ListaStatus } from "../enums/ListaStatus";
import { createSchema, date, enumValue, integer, nullableDate, nullableString, record, string } from "./schema-utils";

function parseLista(input: unknown): Lista {
  const value = record(input);
  return {
    id: string(value.id, "id"),
    bancaId: string(value.bancaId, "bancaId"),
    reparteId: nullableString(value.reparteId, "reparteId"),
    titulo: string(value.titulo, "titulo"),
    slug: string(value.slug, "slug"),
    status: enumValue(ListaStatus, value.status, "status"),
    criadaEm: date(value.criadaEm, "criadaEm"),
    publicadaEm: nullableDate(value.publicadaEm, "publicadaEm"),
    encerradaEm: nullableDate(value.encerradaEm, "encerradaEm"),
    versao: integer(value.versao, "versao", { min: 1 }),
  };
}

export const listaSchema = createSchema(parseLista);
export const parseListaSchema = listaSchema.parse;