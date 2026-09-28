import type { HorarioFuncionamento } from "../../domain/entities/HorarioFuncionamento";
import type { ItemReparte } from "../../domain/entities/ItemReparte";
import type { ItemReserva } from "../../domain/entities/ItemReserva";
import type { Reserva } from "../../domain/entities/Reserva";
import { IntencaoRetirada } from "../../domain/enums/IntencaoRetirada";
import { ItemReparteStatus } from "../../domain/enums/ItemReparteStatus";
import { ItemReservaStatus } from "../../domain/enums/ItemReservaStatus";
import { ReservaStatus } from "../../domain/enums/ReservaStatus";
import { calcularDisponibilidade } from "../../domain/rules/calcularDisponibilidade";
import { validarDataRetirada } from "../../domain/rules/validarDataRetirada";
import { failure, issue, success } from "../../domain/validation";
import type { ValidationIssue, ValidationResult } from "../../domain/validation";

export interface LinhaNovaReserva {
  itemReparte: ItemReparte;
  quantidade: number;
}

export interface ValidarCriacaoReservaInput {
  agora: Date;
  criadaEm: Date;
  dataRetiradaPretendida: Date;
  horarioAproximado?: string | null;
  horarios: readonly HorarioFuncionamento[];
  itens: readonly LinhaNovaReserva[];
}

const estadosItemReparteEncerrados = new Set<ItemReparte["status"]>([
  ItemReparteStatus.BLOQUEADO_PARA_RECOLHIMENTO,
  ItemReparteStatus.AGUARDANDO_RECOLHIMENTO,
  ItemReparteStatus.DEVOLVIDO,
  ItemReparteStatus.ARQUIVADO,
]);

export function validarCriacaoReserva(
  input: ValidarCriacaoReservaInput,
): ValidationResult<ValidarCriacaoReservaInput> {
  const issues: ValidationIssue[] = [];
  if (input.itens.length === 0) {
    issues.push(issue("RESERVA_VAZIA", "itens", "A reserva precisa conter ao menos um item."));
  }

  const menorLimite = input.itens
    .map(({ itemReparte }) => itemReparte.dataFimReservas)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const retirada = validarDataRetirada({
    agora: input.agora,
    criadaEm: input.criadaEm,
    dataRetiradaPretendida: input.dataRetiradaPretendida,
    horarioAproximado: input.horarioAproximado,
    horarios: input.horarios,
    dataFimReservas: menorLimite,
  });
  if (!retirada.ok) issues.push(...retirada.issues);

  const quantidadesPorLote = new Map<string, number>();
  const itensPorLote = new Map<string, ItemReparte>();
  input.itens.forEach((linha, index) => {
    if (!Number.isSafeInteger(linha.quantidade) || linha.quantidade <= 0) {
      issues.push(
        issue("QUANTIDADE_INVALIDA", "itens[" + index + "].quantidade", "A quantidade deve ser um inteiro maior que zero."),
      );
      return;
    }
    const item = linha.itemReparte;
    if (!item.id || !item.produtoId || !item.reparteId) {
      issues.push(
        issue("ORIGEM_INVALIDA", "itens[" + index + "].itemReparte", "Cada reserva precisa apontar para um item de reparte válido."),
      );
      return;
    }
    if (estadosItemReparteEncerrados.has(item.status)) {
      issues.push(
        issue("LOTE_INDISPONIVEL", "itens[" + index + "].itemReparteId", "O item não aceita novas reservas."),
      );
    }
    if (item.dataFimReservas && input.agora.getTime() >= item.dataFimReservas.getTime()) {
      issues.push(
        issue("FIM_DAS_RESERVAS", "itens[" + index + "].itemReparteId", "O prazo de novas reservas terminou para este lote."),
      );
    }
    quantidadesPorLote.set(
      item.id,
      (quantidadesPorLote.get(item.id) ?? 0) + linha.quantidade,
    );
    itensPorLote.set(item.id, item);
  });

  for (const [itemReparteId, quantidadePedida] of quantidadesPorLote) {
    const item = itensPorLote.get(itemReparteId);
    if (!item) continue;
    try {
      const disponivel = calcularDisponibilidade(item);
      if (quantidadePedida > disponivel) {
        issues.push(
          issue(
            "ESTOQUE_INSUFICIENTE",
            "itensReparte/" + itemReparteId,
            "A quantidade solicitada excede o saldo disponível.",
          ),
        );
      }
    } catch (error) {
      issues.push(
        issue(
          "SALDO_INVALIDO",
          "itensReparte/" + itemReparteId,
          error instanceof Error ? error.message : "O saldo do lote é inválido.",
        ),
      );
    }
  }

  return issues.length > 0 ? failure(...issues) : success(input);
}

export function calcularStatusReserva(
  itens: readonly ItemReserva[],
): Reserva["status"] {
  if (itens.length === 0) return ReservaStatus.CANCELADA;

  const retiradas = itens.some((item) => item.quantidadeRetirada > 0);
  const estadosAtivos = new Set<ItemReserva["status"]>([
    ItemReservaStatus.RESERVADO,
    ItemReservaStatus.PARCIALMENTE_RETIRADO,
    ItemReservaStatus.RETIRADA_INFORMADA,
  ]);
  const aindaAtiva = itens.some((item) => estadosAtivos.has(item.status));
  if (retiradas && aindaAtiva) return ReservaStatus.PARCIALMENTE_RETIRADA;
  if (aindaAtiva) return ReservaStatus.ATIVA;
  if (itens.every((item) => item.status === ItemReservaStatus.EXPIRADO)) {
    return ReservaStatus.EXPIRADA;
  }
  if (retiradas) return ReservaStatus.CONCLUIDA;
  return ReservaStatus.CANCELADA;
}

export interface ResultadoRetiradaParcial {
  itemReserva: ItemReserva;
  itemReparte: ItemReparte;
  quantidadeRetiradaNestaOperacao: number;
}

/** Confirma apenas a quantidade informada pelo administrador; intenção do cliente não baixa estoque. */
export function confirmarRetiradaParcial(
  itemReserva: ItemReserva,
  itemReparte: ItemReparte,
  quantidade: number,
  confirmadaPorAdmin: boolean,
  agora = new Date(),
): ValidationResult<ResultadoRetiradaParcial> {
  if (!Number.isFinite(agora.getTime())) {
    return failure(issue("DATA_INVALIDA", "agora", "Informe uma data válida."));
  }
  if (!confirmadaPorAdmin) {
    return failure(
      issue("CONFIRMACAO_ADMIN_NECESSARIA", "confirmadaPorAdmin", "Somente o administrador confirma uma retirada."),
    );
  }
  if (itemReserva.itemReparteId !== itemReparte.id) {
    return failure(
      issue("LINHAGEM_DIVERGENTE", "itemReparteId", "A reserva e o estoque precisam apontar para o mesmo item de reparte."),
    );
  }
  if (!Number.isSafeInteger(quantidade) || quantidade <= 0) {
    return failure(issue("QUANTIDADE_INVALIDA", "quantidade", "Informe um inteiro maior que zero."));
  }
  if (
    itemReserva.status !== ItemReservaStatus.RESERVADO &&
    itemReserva.status !== ItemReservaStatus.PARCIALMENTE_RETIRADO &&
    itemReserva.status !== ItemReservaStatus.RETIRADA_INFORMADA
  ) {
    return failure(issue("ITEM_ENCERRADO", "itemReserva.status", "Este item de reserva já foi encerrado."));
  }
  const restanteDaReserva = itemReserva.quantidade - itemReserva.quantidadeRetirada;
  if (quantidade > restanteDaReserva) {
    return failure(issue("EXCEDE_RESERVA", "quantidade", "A retirada excede a quantidade ainda reservada."));
  }
  if (itemReparte.quantidadeReservada < quantidade) {
    return failure(issue("RESERVA_ESTOQUE_INCONSISTENTE", "itemReparte.quantidadeReservada", "O saldo reservado no lote é menor que a retirada."));
  }
  try {
    calcularDisponibilidade(itemReparte);
  } catch (error) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", error instanceof Error ? error.message : "O saldo do lote é inválido."),
    );
  }

  const quantidadeRetirada = itemReserva.quantidadeRetirada + quantidade;
  const itemReservaAtualizado: ItemReserva = {
    ...itemReserva,
    quantidadeRetirada,
    status:
      quantidadeRetirada === itemReserva.quantidade
        ? ItemReservaStatus.RETIRADO
        : ItemReservaStatus.PARCIALMENTE_RETIRADO,
    atualizadaEm: new Date(agora.getTime()),
  };
  const itemReparteAtualizado: ItemReparte = {
    ...itemReparte,
    quantidadeReservada: itemReparte.quantidadeReservada - quantidade,
    quantidadeRetirada: itemReparte.quantidadeRetirada + quantidade,
  };

  try {
    calcularDisponibilidade(itemReparteAtualizado);
  } catch (error) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", error instanceof Error ? error.message : "A retirada tornaria o saldo inválido."),
    );
  }

  return success({
    itemReserva: itemReservaAtualizado,
    itemReparte: itemReparteAtualizado,
    quantidadeRetiradaNestaOperacao: quantidade,
  });
}

export type MotivoEncerramentoReserva = "CLIENTE" | "BANCA" | "EXPIRADA";

export interface ResultadoCancelamentoItemReserva {
  itemReserva: ItemReserva;
  itemReparte: ItemReparte;
  quantidadeLiberada: number;
}

export function cancelarItemReserva(
  itemReserva: ItemReserva,
  itemReparte: ItemReparte,
  motivo: MotivoEncerramentoReserva,
  agora = new Date(),
): ValidationResult<ResultadoCancelamentoItemReserva> {
  if (!Number.isFinite(agora.getTime())) {
    return failure(issue("DATA_INVALIDA", "agora", "Informe uma data válida."));
  }
  if (itemReserva.itemReparteId !== itemReparte.id) {
    return failure(issue("LINHAGEM_DIVERGENTE", "itemReparteId", "A reserva e o estoque precisam apontar para o mesmo item de reparte."));
  }
  try {
    calcularDisponibilidade(itemReparte);
  } catch (error) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", error instanceof Error ? error.message : "O saldo do lote é inválido."),
    );
  }
  if (
    itemReserva.status !== ItemReservaStatus.RESERVADO &&
    itemReserva.status !== ItemReservaStatus.PARCIALMENTE_RETIRADO &&
    itemReserva.status !== ItemReservaStatus.RETIRADA_INFORMADA
  ) {
    return failure(issue("ITEM_ENCERRADO", "itemReserva.status", "Este item de reserva já foi encerrado."));
  }

  const restante = itemReserva.quantidade - itemReserva.quantidadeRetirada;
  if (restante <= 0 || itemReparte.quantidadeReservada < restante) {
    return failure(issue("RESERVA_ESTOQUE_INCONSISTENTE", "itemReparte.quantidadeReservada", "O lote não contém o saldo reservado esperado."));
  }

  const status =
    motivo === "CLIENTE"
      ? ItemReservaStatus.CANCELADO_CLIENTE
      : motivo === "BANCA"
        ? ItemReservaStatus.CANCELADO_BANCA
        : ItemReservaStatus.EXPIRADO;
  const itemReservaAtualizado: ItemReserva = {
    ...itemReserva,
    status,
    atualizadaEm: new Date(agora.getTime()),
  };
  const itemReparteAtualizado: ItemReparte = {
    ...itemReparte,
    quantidadeReservada: itemReparte.quantidadeReservada - restante,
  };
  try {
    calcularDisponibilidade(itemReparteAtualizado);
  } catch (error) {
    return failure(
      issue("SALDO_INVALIDO", "itemReparte", error instanceof Error ? error.message : "O cancelamento tornaria o saldo inválido."),
    );
  }

  return success({
    itemReserva: itemReservaAtualizado,
    itemReparte: itemReparteAtualizado,
    quantidadeLiberada: restante,
  });
}

export function atualizarIntencaoRetirada(
  reserva: Reserva,
  intencao: IntencaoRetirada,
  agora = new Date(),
): Reserva {
  return {
    ...reserva,
    intencaoRetirada: intencao,
    atualizadaEm: new Date(agora.getTime()),
  };
}

export function validarExpiracaoReserva(
  reserva: Pick<Reserva, "status" | "expiraEm">,
  agora: Date,
): ValidationResult<true> {
  if (!Number.isFinite(agora.getTime()) || !Number.isFinite(reserva.expiraEm.getTime())) {
    return failure(issue("DATA_INVALIDA", "expiraEm", "A data de expiração ou a data atual é inválida."));
  }
  if (reserva.status !== ReservaStatus.ATIVA && reserva.status !== ReservaStatus.PARCIALMENTE_RETIRADA) {
    return failure(issue("RESERVA_ENCERRADA", "status", "A reserva já está encerrada."));
  }
  if (reserva.expiraEm.getTime() > agora.getTime()) {
    return failure(issue("PRAZO_ATIVO", "expiraEm", "O prazo da reserva ainda não terminou."));
  }
  return success(true);
}

export function juntarIssues(
  resultados: readonly ValidationResult<unknown>[],
): ValidationIssue[] {
  return resultados.flatMap((resultado) => (resultado.ok ? [] : resultado.issues));
}
