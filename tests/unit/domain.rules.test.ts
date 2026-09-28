import { describe, expect, it } from "vitest";
import { calcularDisponibilidade } from "../../src/domain/rules/calcularDisponibilidade";
import { calcularExpiracaoReserva } from "../../src/domain/rules/calcularExpiracaoReserva";
import { calcularFimReservas } from "../../src/domain/rules/calcularFimReservas";
import { validarConfiguracaoHorarios } from "../../src/domain/rules/validarHorarioBanca";

describe("regras de domínio comuns", () => {
  it("deriva a disponibilidade e rejeita totais que violam o saldo", () => {
    expect(
      calcularDisponibilidade({
        quantidadeRecebida: 7,
        quantidadeReservada: 2,
        quantidadeRetirada: 1,
        quantidadeDevolvida: 1,
      }),
    ).toBe(3);
    expect(() =>
      calcularDisponibilidade({
        quantidadeRecebida: 2,
        quantidadeReservada: 1,
        quantidadeRetirada: 1,
        quantidadeDevolvida: 1,
      }),
    ).toThrow();
  });

  it("soma a tolerância à retirada sem confundir os dois campos", () => {
    const criadaEm = new Date(2026, 8, 28, 10);
    const retirada = new Date(2026, 8, 29, 10);
    const limiteLote = new Date(2026, 9, 2, 10);
    const expiraEm = calcularExpiracaoReserva(criadaEm, {
      dataRetiradaPretendida: retirada,
      toleranciaRetiradaDias: 2,
      limiteEm: limiteLote,
    });
    expect(expiraEm).toEqual(new Date(2026, 9, 1, 10));
    expect(expiraEm).not.toEqual(retirada);
  });

  it("aplica a margem de dois dias antes do recolhimento", () => {
    const recolhimento = new Date(2026, 9, 10, 12);
    expect(calcularFimReservas(recolhimento)?.getDate()).toBe(8);
  });

  it("rejeita configuração semanal com o mesmo dia repetido", () => {
    const semana = Array.from({ length: 7 }, (_, diaSemana) => ({
      diaSemana,
      fechado: diaSemana === 0,
      abre: diaSemana === 0 ? null : "08:00",
      fecha: diaSemana === 0 ? null : "18:00",
    }));
    semana[6] = { ...semana[6], diaSemana: 5 };
    expect(validarConfiguracaoHorarios(semana).ok).toBe(false);
  });
});
