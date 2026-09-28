import type { ItemReparte } from "../entities/ItemReparte";
import { ItemReparteStatus } from "../enums/ItemReparteStatus";
import { calcularDisponibilidade } from "../rules/calcularDisponibilidade";
import { createSchema, enumValue, integer, nullableDate, nullableNumber, nullableString, record, rejectSchema, string } from "./schema-utils";

function parseItemReparte(input: unknown): ItemReparte {
  const value = record(input);
  const item: ItemReparte = {
    id: string(value.id, "id"),
    bancaId: string(value.bancaId, "bancaId"),
    reparteId: string(value.reparteId, "reparteId"),
    produtoId: string(value.produtoId, "produtoId"),
    tituloSnapshot: string(value.tituloSnapshot, "tituloSnapshot"),
    volumeSnapshot: nullableString(value.volumeSnapshot, "volumeSnapshot"),
    precoVenda: nullableNumber(value.precoVenda, "precoVenda"),
    quantidadeRecebida: integer(value.quantidadeRecebida, "quantidadeRecebida"),
    quantidadeReservada: integer(value.quantidadeReservada, "quantidadeReservada"),
    quantidadeRetirada: integer(value.quantidadeRetirada, "quantidadeRetirada"),
    quantidadeDevolvida: integer(value.quantidadeDevolvida, "quantidadeDevolvida"),
    dataRecolhimentoOverride: nullableDate(value.dataRecolhimentoOverride, "dataRecolhimentoOverride"),
    dataFimReservas: nullableDate(value.dataFimReservas, "dataFimReservas"),
    status: enumValue(ItemReparteStatus, value.status, "status"),
    publicadoEm: nullableDate(value.publicadoEm, "publicadoEm"),
  };
  if (item.precoVenda !== null && item.precoVenda < 0) {
    rejectSchema("PRECO_INVALIDO", "precoVenda", "O preço não pode ser negativo.");
  }
  calcularDisponibilidade(item);
  return item;
}

export const itemReparteSchema = createSchema(parseItemReparte);
export const parseItemReparteSchema = itemReparteSchema.parse;
