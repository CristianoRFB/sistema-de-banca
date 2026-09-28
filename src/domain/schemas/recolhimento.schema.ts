import type { ItemRecolhimento } from "../entities/ItemRecolhimento";
import type { Recolhimento } from "../entities/Recolhimento";
import { RecolhimentoStatus } from "../enums/RecolhimentoStatus";
import { boolean, createSchema, date, enumValue, integer, nullableDate, nullableNumber, nullableString, record, rejectSchema, string } from "./schema-utils";

function parseRecolhimento(input: unknown): Recolhimento {
  const value = record(input);
  return {
    id: string(value.id, "id"),
    bancaId: string(value.bancaId, "bancaId"),
    reparteId: string(value.reparteId, "reparteId"),
    dataPrevista: date(value.dataPrevista, "dataPrevista"),
    iniciadoEm: nullableDate(value.iniciadoEm, "iniciadoEm"),
    confirmadoEm: nullableDate(value.confirmadoEm, "confirmadoEm"),
    status: enumValue(RecolhimentoStatus, value.status, "status"),
    observacoes: nullableString(value.observacoes, "observacoes"),
  };
}

function parseItemRecolhimento(input: unknown): ItemRecolhimento {
  const value = record(input);
  const esperado = integer(value.quantidadeEsperada, "quantidadeEsperada");
  const encontrado = nullableNumber(value.quantidadeEncontrada, "quantidadeEncontrada");
  const devolvido = nullableNumber(value.quantidadeDevolvida, "quantidadeDevolvida");
  if (
    (encontrado !== null && (!Number.isSafeInteger(encontrado) || encontrado < 0)) ||
    (devolvido !== null && (!Number.isSafeInteger(devolvido) || devolvido < 0))
  ) {
    rejectSchema("CONTAGEM_INVALIDA", "quantidadeEncontrada", "As quantidades conferidas devem ser inteiros não negativos.");
  }
  const divergente = boolean(value.divergente, "divergente");
  if (encontrado !== null && divergente !== (encontrado !== esperado)) {
    rejectSchema("DIVERGENCIA_INCONSISTENTE", "divergente", "O indicador deve corresponder à diferença entre esperado e encontrado.");
  }
  return {
    id: string(value.id, "id"),
    recolhimentoId: string(value.recolhimentoId, "recolhimentoId"),
    itemReparteId: string(value.itemReparteId, "itemReparteId"),
    produtoId: string(value.produtoId, "produtoId"),
    quantidadeEsperada: esperado,
    quantidadeEncontrada: encontrado,
    quantidadeDevolvida: devolvido,
    divergente,
    observacao: nullableString(value.observacao, "observacao"),
  };
}

export const recolhimentoSchema = createSchema(parseRecolhimento);
export const itemRecolhimentoSchema = createSchema(parseItemRecolhimento);
export const parseRecolhimentoSchema = recolhimentoSchema.parse;
