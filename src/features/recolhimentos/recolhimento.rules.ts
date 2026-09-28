import type { ItemRecolhimento } from "../../domain/entities/ItemRecolhimento";
import type { ItemReparte } from "../../domain/entities/ItemReparte";
import { detectarDivergencia } from "../../domain/rules/detectarDivergencia";
import { validarRecolhimento } from "../../domain/rules/validarRecolhimento";
import { failure, issue, success } from "../../domain/validation";
import type { ValidationIssue, ValidationResult } from "../../domain/validation";

export type ResolucaoDivergencia =
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "VINCULAR_OUTRO_LOTE"
  | "VENDA_NAO_REGISTRADA"
  | "RETIRADA"
  | "PERDA_AVARIA"
  | "ERRO"
  | "MANTER_PENDENTE"
  | "OUTRO";

const resolucoesQueExigemMotivo = new Set<ResolucaoDivergencia>([
  "AJUSTE_POSITIVO",
  "AJUSTE_NEGATIVO",
  "VINCULAR_OUTRO_LOTE",
  "OUTRO",
  "ERRO",
]);

export interface ResultadoConferencia {
  itemRecolhimento: ItemRecolhimento;
  divergencia: ReturnType<typeof detectarDivergencia>;
  podeRegistrarContagem: true;
  podeEncerrarRecolhimento: boolean;
  resolucaoNecessaria: boolean;
}

export function conferirItemRecolhimento(
  itemRecolhimento: ItemRecolhimento,
  itemReparte: ItemReparte,
  quantidadeEncontrada: number,
): ValidationResult<ResultadoConferencia> {
  if (itemRecolhimento.itemReparteId !== itemReparte.id) {
    return failure(
      issue("LINHAGEM_DIVERGENTE", "itemReparteId", "A conferência precisa usar o lote original do item reservado."),
    );
  }

  const conferencia = validarRecolhimento(itemReparte, quantidadeEncontrada);
  if (!conferencia.ok) return conferencia;

  const valor = conferencia.value;
  if (valor.encontrado === null) {
    return failure(issue("CONTAGEM_AUSENTE", "quantidadeEncontrada", "Informe a quantidade física encontrada."));
  }

  const divergencia = detectarDivergencia(valor.esperado, valor.encontrado);
  const atualizado: ItemRecolhimento = {
    ...itemRecolhimento,
    quantidadeEsperada: valor.esperado,
    quantidadeEncontrada: valor.encontrado,
    quantidadeDevolvida: valor.devolvido,
    divergente: divergencia.divergente,
  };

  return success({
    itemRecolhimento: atualizado,
    divergencia,
    podeRegistrarContagem: true,
    podeEncerrarRecolhimento: !divergencia.divergente,
    resolucaoNecessaria: divergencia.divergente,
  });
}

export interface ResolucaoInput {
  divergencia: ReturnType<typeof detectarDivergencia>;
  resolucao: ResolucaoDivergencia;
  motivo?: string | null;
}

export function validarResolucaoDivergencia(
  input: ResolucaoInput,
): ValidationResult<{ resolucao: ResolucaoDivergencia; motivo: string | null }> {
  const motivo = input.motivo?.trim() || null;
  if (!input.divergencia.divergente) {
    return success({ resolucao: input.resolucao, motivo });
  }
  if (input.resolucao === "MANTER_PENDENTE") {
    return success({ resolucao: input.resolucao, motivo });
  }
  if (
    (input.resolucao === "AJUSTE_POSITIVO" && input.divergencia.diferenca < 0) ||
    (input.resolucao === "AJUSTE_NEGATIVO" && input.divergencia.diferenca > 0)
  ) {
    return failure(
      issue("AJUSTE_INCOMPATIVEL", "resolucao", "O tipo de ajuste não corresponde à diferença contada."),
    );
  }
  if (!motivo && resolucoesQueExigemMotivo.has(input.resolucao)) {
    return failure(
      issue("MOTIVO_OBRIGATORIO", "motivo", "Descreva o motivo ou lote de destino para manter a reconciliação auditável."),
    );
  }
  return success({ resolucao: input.resolucao, motivo });
}

/** Uma divergência pode ser salva, mas não encerrada enquanto ficar pendente. */
export function validarEncerramentoRecolhimento(
  itens: readonly ItemRecolhimento[],
  resolucoes: Readonly<Record<string, ResolucaoDivergencia | undefined>>,
  motivos: Readonly<Record<string, string | null | undefined>> = {},
  reservasAtivasPorItemReparte: Readonly<Record<string, number | undefined>> = {},
): ValidationResult<true> {
  const issues: ValidationIssue[] = [];
  if (itens.length === 0) {
    issues.push(issue("RECOLHIMENTO_VAZIO", "itens", "O recolhimento precisa conter itens."));
  }
  itens.forEach((item, index) => {
    const reservasAtivas =
      reservasAtivasPorItemReparte[item.itemReparteId] ?? 0;
    if (!Number.isSafeInteger(reservasAtivas) || reservasAtivas < 0) {
      issues.push(
        issue("RESERVAS_INVALIDAS", "itens[" + index + "]", "O total de reservas ativas é inválido."),
      );
    } else if (reservasAtivas > 0) {
      issues.push(
        issue("RESERVAS_ATIVAS", "itens[" + index + "]", "Resolva as reservas ativas antes de encerrar o recolhimento."),
      );
    }
    if (item.quantidadeEncontrada === null) {
      issues.push(
        issue("CONTAGEM_PENDENTE", "itens[" + index + "]", "Todos os itens precisam de contagem física."),
      );
    }
    if (item.divergente) {
      const resolucao = resolucoes[item.id];
      if (!resolucao || resolucao === "MANTER_PENDENTE") {
        issues.push(
          issue("DIVERGENCIA_PENDENTE", "itens[" + index + "]", "Resolva a divergência ou mantenha o recolhimento em conferência."),
        );
      } else if (item.quantidadeEncontrada !== null) {
        const divergencia = detectarDivergencia(
          item.quantidadeEsperada,
          item.quantidadeEncontrada,
        );
        const validacaoResolucao = validarResolucaoDivergencia({
          divergencia,
          resolucao,
          motivo: motivos[item.id],
        });
        if (!validacaoResolucao.ok) issues.push(...validacaoResolucao.issues);
      }
    }
  });
  return issues.length > 0 ? failure(...issues) : success(true);
}

export function coletarIssuesRecolhimento(
  resultados: readonly ValidationResult<unknown>[],
): ValidationIssue[] {
  return resultados.flatMap((resultado) => (resultado.ok ? [] : resultado.issues));
}
