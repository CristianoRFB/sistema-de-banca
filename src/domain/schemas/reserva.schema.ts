import type { ItemReserva } from "../entities/ItemReserva";
import type { Reserva } from "../entities/Reserva";
import { IntencaoRetirada } from "../enums/IntencaoRetirada";
import { ItemReservaStatus } from "../enums/ItemReservaStatus";
import { ReservaStatus } from "../enums/ReservaStatus";
import { validarHorarioAproximado } from "../rules/validarHorarioBanca";
import { createSchema, date, enumValue, integer, nullableNumber, nullableString, record, rejectSchema, string, boolean } from "./schema-utils";

function parseReserva(input: unknown): Reserva {
  const value = record(input);
  const retirada = date(value.dataRetiradaPretendida, "dataRetiradaPretendida");
  const expira = date(value.expiraEm, "expiraEm");
  const criada = date(value.criadaEm, "criadaEm");
  const horarioAproximado = nullableString(value.horarioAproximado, "horarioAproximado");
  const horarioValidado = validarHorarioAproximado(horarioAproximado);
  if (!horarioValidado.ok) {
    rejectSchema(
      horarioValidado.issues[0].code,
      horarioValidado.issues[0].path,
      horarioValidado.issues[0].message,
    );
  }
  if (expira.getTime() <= criada.getTime()) {
    rejectSchema("EXPIRACAO_INVALIDA", "expiraEm", "A expiração deve ser posterior à criação da reserva.");
  }
  return {
    id: string(value.id, "id"),
    bancaId: string(value.bancaId, "bancaId"),
    clienteId: string(value.clienteId, "clienteId"),
    clienteNomeSnapshot: string(value.clienteNomeSnapshot, "clienteNomeSnapshot"),
    clienteTelefoneFinal: string(value.clienteTelefoneFinal, "clienteTelefoneFinal"),
    criadaEm: criada,
    dataRetiradaPretendida: retirada,
    horarioAproximado: horarioValidado.value,
    expiraEm: expira,
    status: enumValue(ReservaStatus, value.status, "status"),
    intencaoRetirada: enumValue(IntencaoRetirada, value.intencaoRetirada, "intencaoRetirada"),
    lembreteMeioEnviado: boolean(value.lembreteMeioEnviado, "lembreteMeioEnviado"),
    lembreteDiaEnviado: boolean(value.lembreteDiaEnviado, "lembreteDiaEnviado"),
    lembreteFechamentoEnviado: boolean(value.lembreteFechamentoEnviado, "lembreteFechamentoEnviado"),
    atualizadaEm: date(value.atualizadaEm, "atualizadaEm"),
  };
}

function parseItemReserva(input: unknown): ItemReserva {
  const value = record(input);
  const quantidade = integer(value.quantidade, "quantidade", { min: 1 });
  const quantidadeRetirada = integer(value.quantidadeRetirada, "quantidadeRetirada");
  if (quantidadeRetirada > quantidade) {
    rejectSchema("RETIRADA_ACIMA_DA_RESERVA", "quantidadeRetirada", "A quantidade retirada não pode exceder a quantidade reservada.");
  }
  const status = enumValue(ItemReservaStatus, value.status, "status");
  if (status === ItemReservaStatus.RETIRADO && quantidadeRetirada !== quantidade) {
    rejectSchema("STATUS_RETIRADO_INVALIDO", "status", "Uma linha no estado RETIRADO deve ter toda a quantidade retirada.");
  }
  if (quantidadeRetirada === quantidade && status !== ItemReservaStatus.RETIRADO) {
    rejectSchema("STATUS_RETIRADO_INVALIDO", "status", "Uma linha totalmente retirada deve estar no estado RETIRADO.");
  }
  if (
    quantidadeRetirada > 0 &&
    quantidadeRetirada < quantidade &&
    status !== ItemReservaStatus.PARCIALMENTE_RETIRADO &&
    status !== ItemReservaStatus.CANCELADO_CLIENTE &&
    status !== ItemReservaStatus.CANCELADO_BANCA &&
    status !== ItemReservaStatus.EXPIRADO
  ) {
    rejectSchema("STATUS_PARCIAL_INVALIDO", "status", "Uma retirada parcial exige um estado compatível.");
  }
  if (
    status === ItemReservaStatus.PARCIALMENTE_RETIRADO &&
    (quantidadeRetirada === 0 || quantidadeRetirada === quantidade)
  ) {
    rejectSchema("STATUS_PARCIAL_INVALIDO", "status", "O estado parcial precisa de quantidade retirada menor que o total e maior que zero.");
  }
  if (
    (status === ItemReservaStatus.RESERVADO ||
      status === ItemReservaStatus.RETIRADA_INFORMADA) &&
    quantidadeRetirada !== 0
  ) {
    rejectSchema("STATUS_RESERVADO_INVALIDO", "status", "Uma reserva ainda não confirmada pelo administrador deve ter quantidade retirada igual a zero.");
  }
  const preco = nullableNumber(value.precoUnitarioSnapshot, "precoUnitarioSnapshot");
  if (preco !== null && preco < 0) {
    rejectSchema("PRECO_INVALIDO", "precoUnitarioSnapshot", "O preço não pode ser negativo.");
  }
  return {
    id: string(value.id, "id"),
    reservaId: string(value.reservaId, "reservaId"),
    bancaId: string(value.bancaId, "bancaId"),
    itemReparteId: string(value.itemReparteId, "itemReparteId"),
    produtoId: string(value.produtoId, "produtoId"),
    quantidade,
    quantidadeRetirada,
    precoUnitarioSnapshot: preco,
    status,
    criadaEm: date(value.criadaEm, "criadaEm"),
    atualizadaEm: date(value.atualizadaEm, "atualizadaEm"),
  };
}

export const reservaSchema = createSchema(parseReserva);
export const itemReservaSchema = createSchema(parseItemReserva);
export const parseReservaSchema = reservaSchema.parse;
