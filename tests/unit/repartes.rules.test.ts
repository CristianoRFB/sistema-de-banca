import { describe, expect, it } from "vitest";
import type { ItemReparte } from "../../src/domain/entities/ItemReparte";
import { ItemReparteStatus } from "../../src/domain/enums/ItemReparteStatus";
import { calcularDisponibilidade } from "../../src/domain/rules/calcularDisponibilidade";
import {
  derivarStatusItemReparte,
  validarQuantidadeRecebida,
  verificarDisponibilidadeReparte,
} from "../../src/features/repartes/reparte.rules";

function item(overrides: Partial<ItemReparte> = {}): ItemReparte {
  return {
    id: "ir-1",
    bancaId: "b-1",
    reparteId: "r-1",
    produtoId: "p-1",
    tituloSnapshot: "Manga",
    volumeSnapshot: "09",
    precoVenda: 10,
    quantidadeRecebida: 4,
    quantidadeReservada: 1,
    quantidadeRetirada: 1,
    quantidadeDevolvida: 0,
    dataRecolhimentoOverride: null,
    dataFimReservas: null,
    status: ItemReparteStatus.RESERVADO,
    publicadoEm: null,
    ...overrides,
  };
}

describe("regras de reparte", () => {
  it("deriva disponibilidade sem confiar em um total materializado", () => {
    const estoque = item();
    expect(calcularDisponibilidade(estoque)).toBe(2);
    expect(verificarDisponibilidadeReparte(estoque, new Date(2026, 8, 28)).ok).toBe(true);
  });

  it("não permite reduzir o recebido abaixo do que já foi comprometido", () => {
    const resultado = validarQuantidadeRecebida(item(), 1);
    expect(resultado.ok).toBe(false);
  });

  it("bloqueia novas reservas no limite sem marcar o item como devolvido", () => {
    const limite = new Date(2026, 8, 28, 10);
    const estoque = item({ dataFimReservas: limite });
    expect(derivarStatusItemReparte(estoque, limite)).toBe(
      ItemReparteStatus.BLOQUEADO_PARA_RECOLHIMENTO,
    );
  });
});