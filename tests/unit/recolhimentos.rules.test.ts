import { describe, expect, it } from "vitest";
import type { ItemRecolhimento } from "../../src/domain/entities/ItemRecolhimento";
import type { ItemReparte } from "../../src/domain/entities/ItemReparte";
import { ItemReparteStatus } from "../../src/domain/enums/ItemReparteStatus";
import {
  conferirItemRecolhimento,
  validarEncerramentoRecolhimento,
} from "../../src/features/recolhimentos/recolhimento.rules";

const estoque: ItemReparte = {
  id: "ir-1",
  bancaId: "b-1",
  reparteId: "r-1",
  produtoId: "p-1",
  tituloSnapshot: "Produto",
  volumeSnapshot: null,
  precoVenda: 15,
  quantidadeRecebida: 8,
  quantidadeReservada: 1,
  quantidadeRetirada: 2,
  quantidadeDevolvida: 0,
  dataRecolhimentoOverride: null,
  dataFimReservas: null,
  status: ItemReparteStatus.AGUARDANDO_RECOLHIMENTO,
  publicadoEm: null,
};
const itemRecolhimento: ItemRecolhimento = {
  id: "item-rec-1",
  recolhimentoId: "rec-1",
  itemReparteId: "ir-1",
  produtoId: "p-1",
  quantidadeEsperada: 6,
  quantidadeEncontrada: null,
  quantidadeDevolvida: null,
  divergente: false,
  observacao: null,
};

describe("regras de recolhimento", () => {
  it("aceita registrar uma contagem física divergente e mantém o encerramento pendente", () => {
    const resultado = conferirItemRecolhimento(itemRecolhimento, estoque, 5);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value.podeRegistrarContagem).toBe(true);
    expect(resultado.value.itemRecolhimento.quantidadeEncontrada).toBe(5);
    expect(resultado.value.resolucaoNecessaria).toBe(true);
    expect(
      validarEncerramentoRecolhimento([resultado.value.itemRecolhimento], {}).ok,
    ).toBe(false);
  });
});