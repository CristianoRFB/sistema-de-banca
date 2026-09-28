import type { ItemReparte } from "../entities/ItemReparte";
import { calcularQuantidadeFisicaEsperada } from "./calcularDisponibilidade";
import { detectarDivergencia } from "./detectarDivergencia";
import { failure, issue, success } from "../validation";
import type { ValidationResult } from "../validation";

export interface ConferenciaFisica {
  esperado: number;
  encontrado: number | null;
  devolvido: number | null;
  divergente: boolean;
  podeRegistrar: boolean;
  exigeResolucao: boolean;
  diferenca: number | null;
}

/**
 * A contagem física válida sempre pode ser registrada, mesmo quando diverge.
 * Divergências exigem ajuste/motivo, não podem bloquear a conferência real.
 */
export function validarRecolhimento(
  item: Pick<
    ItemReparte,
    "quantidadeRecebida" | "quantidadeRetirada" | "quantidadeDevolvida"
  >,
  encontrado: number | null,
): ValidationResult<ConferenciaFisica> {
  let esperado: number;
  try {
    esperado = calcularQuantidadeFisicaEsperada(item);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Os totais do lote são inválidos.";
    return failure(issue("TOTAIS_INVALIDOS", "itemReparte", message));
  }

  if (encontrado === null) {
    return success({
      esperado,
      encontrado: null,
      devolvido: null,
      divergente: false,
      podeRegistrar: false,
      exigeResolucao: false,
      diferenca: null,
    });
  }
  if (!Number.isSafeInteger(encontrado) || encontrado < 0) {
    return failure(
      issue("CONTAGEM_INVALIDA", "quantidadeEncontrada", "A quantidade encontrada deve ser um inteiro não negativo."),
    );
  }

  const diferenca = detectarDivergencia(esperado, encontrado);
  return success({
    esperado,
    encontrado,
    devolvido: encontrado,
    divergente: diferenca.divergente,
    podeRegistrar: true,
    exigeResolucao: diferenca.divergente,
    diferenca: diferenca.diferenca,
  });
}