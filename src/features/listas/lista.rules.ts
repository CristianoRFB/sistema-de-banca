import type { ItemLista } from "../../domain/entities/ItemLista";
import type { ItemReparte } from "../../domain/entities/ItemReparte";
import type { Lista } from "../../domain/entities/Lista";
import { ListaStatus } from "../../domain/enums/ListaStatus";
import { calcularDisponibilidade } from "../../domain/rules/calcularDisponibilidade";
import { failure, issue, success } from "../../domain/validation";
import type { ValidationIssue, ValidationResult } from "../../domain/validation";

const proximoEstado: Partial<Record<Lista["status"], Lista["status"]>> = {
  [ListaStatus.RASCUNHO]: ListaStatus.PUBLICADA,
  [ListaStatus.PUBLICADA]: ListaStatus.ENCERRADA,
  [ListaStatus.ENCERRADA]: ListaStatus.ARQUIVADA,
};

export function validarTransicaoLista(
  lista: Pick<Lista, "status">,
  proximo: Lista["status"],
): ValidationResult<Lista["status"]> {
  if (proximoEstado[lista.status] !== proximo) {
    return failure(
      issue("TRANSICAO_LISTA_INVALIDA", "status", "Esta mudança de estado não é permitida."),
    );
  }
  return success(proximo);
}

export interface ItemPublicacaoLista {
  itemLista: ItemLista;
  itemReparte: ItemReparte | null;
}

/** Publicação só mostra itens ativos que ainda pertencem a um lote reconhecido. */
export function validarPublicacaoLista(
  itens: readonly ItemPublicacaoLista[],
): ValidationResult<readonly ItemPublicacaoLista[]> {
  const issues: ValidationIssue[] = [];
  const ativos = itens.filter((linha) => linha.itemLista.ativo);
  if (ativos.length === 0) {
    issues.push(issue("LISTA_VAZIA", "itens", "Ative ao menos um item antes de publicar."));
  }

  ativos.forEach((linha, index) => {
    if (!linha.itemReparte || linha.itemReparte.id !== linha.itemLista.itemReparteId) {
      issues.push(
        issue("LINHAGEM_INVALIDA", "itens[" + index + "].itemReparteId", "O item da lista deve apontar para um lote existente."),
      );
      return;
    }
    if (linha.itemReparte.produtoId !== linha.itemLista.produtoId) {
      issues.push(
        issue("PRODUTO_DIVERGENTE", "itens[" + index + "].produtoId", "O produto não corresponde ao item de reparte selecionado."),
      );
      return;
    }
    try {
      calcularDisponibilidade(linha.itemReparte);
    } catch (error) {
      issues.push(
        issue("SALDO_INVALIDO", "itens[" + index + "]", error instanceof Error ? error.message : "O saldo do lote é inválido."),
      );
    }
  });

  return issues.length > 0 ? failure(...issues) : success(itens);
}

/** Soft-hide bloqueia novas reservas sem remover linhas históricas ou reservas existentes. */
export function ocultarItemLista(item: ItemLista): ItemLista {
  return { ...item, ativo: false };
}

export function validarRemocaoItemLista(
  item: ItemLista,
  quantidadeReservadaAtiva: number,
): ValidationResult<true> {
  if (!Number.isSafeInteger(quantidadeReservadaAtiva) || quantidadeReservadaAtiva < 0) {
    return failure(issue("QUANTIDADE_INVALIDA", "quantidadeReservadaAtiva", "Informe uma quantidade válida."));
  }
  if (quantidadeReservadaAtiva > 0) {
    return failure(
      issue("RESERVAS_ATIVAS", "itemLista", "Não remova um item com reservas ativas; oculte novas reservas."),
    );
  }
  if (!item.id) {
    return failure(issue("ITEM_INVALIDO", "itemLista.id", "O item precisa de uma identificação."));
  }
  return success(true);
}

export function validarEdicaoQuantidadeLista(
  quantidadeSolicitada: number,
  quantidadeReservada: number,
  quantidadeRetirada: number,
  quantidadeDevolvida = 0,
): ValidationResult<number> {
  if (
    !Number.isSafeInteger(quantidadeSolicitada) ||
    quantidadeSolicitada < 0 ||
    !Number.isSafeInteger(quantidadeReservada) ||
    quantidadeReservada < 0 ||
    !Number.isSafeInteger(quantidadeRetirada) ||
    quantidadeRetirada < 0 ||
    !Number.isSafeInteger(quantidadeDevolvida) ||
    quantidadeDevolvida < 0
  ) {
    return failure(issue("QUANTIDADE_INVALIDA", "quantidade", "Informe quantidades inteiras não negativas."));
  }
  if (
    quantidadeSolicitada <
    quantidadeReservada + quantidadeRetirada + quantidadeDevolvida
  ) {
    return failure(
      issue("ABAIXO_DO_COMPROMETIDO", "quantidade", "A quantidade não pode ficar abaixo de reservas e retiradas existentes."),
    );
  }
  return success(quantidadeSolicitada);
}

export function coletarIssuesLista(
  resultados: readonly ValidationResult<unknown>[],
): ValidationIssue[] {
  return resultados.flatMap((resultado) => (resultado.ok ? [] : resultado.issues));
}
