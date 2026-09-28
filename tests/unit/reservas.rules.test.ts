import { describe, expect, it } from "vitest";
import type { HorarioFuncionamento } from "../../src/domain/entities/HorarioFuncionamento";
import type { ItemReparte } from "../../src/domain/entities/ItemReparte";
import type { ItemReserva } from "../../src/domain/entities/ItemReserva";
import { ItemReparteStatus } from "../../src/domain/enums/ItemReparteStatus";
import { ItemReservaStatus } from "../../src/domain/enums/ItemReservaStatus";
import { ReservaStatus } from "../../src/domain/enums/ReservaStatus";
import {
  calcularStatusReserva,
  confirmarRetiradaParcial,
  validarCriacaoReserva,
} from "../../src/features/reservas/reserva.rules";
import { calcularDisponibilidade } from "../../src/domain/rules/calcularDisponibilidade";
import { validarHorarioBanca } from "../../src/domain/rules/validarHorarioBanca";

function itemReparte(overrides: Partial<ItemReparte> = {}): ItemReparte {
  return {
    id: "item-reparte-1",
    bancaId: "banca-1",
    reparteId: "reparte-1",
    produtoId: "produto-1",
    tituloSnapshot: "Produto",
    volumeSnapshot: "01",
    precoVenda: 20,
    quantidadeRecebida: 5,
    quantidadeReservada: 3,
    quantidadeRetirada: 0,
    quantidadeDevolvida: 0,
    dataRecolhimentoOverride: null,
    dataFimReservas: null,
    status: ItemReparteStatus.RESERVADO,
    publicadoEm: new Date(2026, 8, 1),
    ...overrides,
  };
}

const horarios: HorarioFuncionamento[] = Array.from({ length: 7 }, (_, diaSemana) => ({
  diaSemana,
  fechado: false,
  abre: "08:00",
  fecha: "18:00",
}));

describe("regras de reserva", () => {
  it("preserva a origem do lote e rejeita mais unidades do que há no saldo livre", () => {
    const lote = itemReparte();
    const resultado = validarCriacaoReserva({
      agora: new Date(2026, 8, 28, 10),
      criadaEm: new Date(2026, 8, 28, 10),
      dataRetiradaPretendida: new Date(2026, 8, 29, 10),
      horarios,
      itens: [{ itemReparte: lote, quantidade: 3 }],
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.issues.some((entry) => entry.code === "ESTOQUE_INSUFICIENTE")).toBe(true);
    }
    expect(lote.id).toBe("item-reparte-1");
  });

  it("confirma retirada parcial sem perder a linhagem e preserva a equação de estoque", () => {
    const lote = itemReparte();
    const reserva: ItemReserva = {
      id: "item-reserva-1",
      reservaId: "reserva-1",
      bancaId: "banca-1",
      itemReparteId: lote.id,
      produtoId: lote.produtoId,
      quantidade: 3,
      quantidadeRetirada: 0,
      precoUnitarioSnapshot: 20,
      status: ItemReservaStatus.RESERVADO,
      criadaEm: new Date(2026, 8, 28, 10),
      atualizadaEm: new Date(2026, 8, 28, 10),
    };

    const resultado = confirmarRetiradaParcial(reserva, lote, 1, true, new Date(2026, 8, 28, 11));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.value.itemReserva.itemReparteId).toBe(lote.id);
    expect(resultado.value.itemReserva.quantidadeRetirada).toBe(1);
    expect(resultado.value.itemReserva.status).toBe(ItemReservaStatus.PARCIALMENTE_RETIRADO);
    expect(resultado.value.itemReparte.quantidadeReservada).toBe(2);
    expect(resultado.value.itemReparte.quantidadeRetirada).toBe(1);
    expect(calcularDisponibilidade(resultado.value.itemReparte)).toBe(2);
  });

  it("não trata a intenção do cliente como confirmação de retirada", () => {
    const itens: ItemReserva[] = [{
      id: "ir-1",
      reservaId: "r-1",
      bancaId: "b-1",
      itemReparteId: "lote-1",
      produtoId: "p-1",
      quantidade: 1,
      quantidadeRetirada: 0,
      precoUnitarioSnapshot: null,
      status: ItemReservaStatus.RETIRADA_INFORMADA,
      criadaEm: new Date(2026, 8, 28),
      atualizadaEm: new Date(2026, 8, 28),
    }];
    expect(calcularStatusReserva(itens)).toBe(ReservaStatus.ATIVA);
    expect(itens[0].quantidadeRetirada).toBe(0);
  });

  it("inclui a abertura e exclui o horário de fechamento", () => {
    const dia = new Date(2026, 8, 28);
    const horarioDoDia = [{ diaSemana: dia.getDay(), fechado: false, abre: "08:00", fecha: "18:00" }];
    const abre = new Date(2026, 8, 28, 8);
    const fecha = new Date(2026, 8, 28, 18);
    expect(validarHorarioBanca(abre, horarioDoDia).ok).toBe(true);
    expect(validarHorarioBanca(fecha, horarioDoDia).ok).toBe(false);
  });
});
