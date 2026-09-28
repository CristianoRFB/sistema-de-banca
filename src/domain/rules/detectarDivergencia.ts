import type { TipoDivergenciaRecolhimento } from "../enums/TipoDivergenciaRecolhimento";
import { TipoDivergenciaRecolhimento as Tipo } from "../enums/TipoDivergenciaRecolhimento";
import { DomainRuleError } from "../validation";

export interface ResultadoDivergencia {
  divergente: boolean;
  tipo: TipoDivergenciaRecolhimento | null;
  esperado: number;
  encontrado: number;
  diferenca: number;
}

export function detectarDivergencia(
  esperado: number,
  encontrado: number,
): ResultadoDivergencia {
  if (
    !Number.isSafeInteger(esperado) ||
    !Number.isSafeInteger(encontrado) ||
    esperado < 0 ||
    encontrado < 0
  ) {
    throw new DomainRuleError(
      "CONTAGEM_INVALIDA",
      "As quantidades esperada e encontrada devem ser inteiros não negativos.",
    );
  }

  const diferenca = encontrado - esperado;
  return {
    divergente: diferenca !== 0,
    tipo:
      diferenca > 0
        ? Tipo.SOBRA
        : diferenca < 0
          ? Tipo.FALTA
          : null,
    esperado,
    encontrado,
    diferenca,
  };
}