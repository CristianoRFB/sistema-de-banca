import type { HorarioFuncionamento } from "../entities/HorarioFuncionamento";
import { failure, issue, success } from "../validation";
import type { ValidationIssue, ValidationResult } from "../validation";

export interface JanelaFuncionamento {
  abreEm: Date;
  fechaEm: Date;
}

function parseHora(hora: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Retorna os limites locais do expediente para a data informada. */
export function obterJanelaFuncionamento(
  data: Date,
  horarios: readonly HorarioFuncionamento[],
): ValidationResult<JanelaFuncionamento> {
  if (!Number.isFinite(data.getTime())) {
    return failure(issue("DATA_INVALIDA", "data", "A data informada é inválida."));
  }

  const horario = horarios.find((item) => item.diaSemana === data.getDay());
  if (!horario) {
    return failure(
      issue("HORARIO_NAO_CONFIGURADO", "horarios", "Não há horário configurado para este dia."),
    );
  }
  if (horario.fechado) {
    return failure(
      issue("BANCA_FECHADA", "data", "A banca não funciona neste dia."),
    );
  }

  const abre = horario.abre === null ? null : parseHora(horario.abre);
  const fecha = horario.fecha === null ? null : parseHora(horario.fecha);
  if (abre === null || fecha === null || fecha <= abre) {
    return failure(
      issue("HORARIO_INVALIDO", "horarios", "O horário de funcionamento está incompleto ou inválido."),
    );
  }

  const abreEm = new Date(data);
  abreEm.setHours(Math.floor(abre / 60), abre % 60, 0, 0);
  const fechaEm = new Date(data);
  fechaEm.setHours(Math.floor(fecha / 60), fecha % 60, 0, 0);
  return success({ abreEm, fechaEm });
}

/** Verifica o expediente local indicado pela data. Início é inclusivo e fechamento exclusivo. */
export function validarHorarioBanca(
  data: Date,
  horarios: readonly HorarioFuncionamento[],
): ValidationResult<HorarioFuncionamento> {
  const janela = obterJanelaFuncionamento(data, horarios);
  if (!janela.ok) return janela;

  const instante = data.getTime();
  if (
    instante < janela.value.abreEm.getTime() ||
    instante >= janela.value.fechaEm.getTime()
  ) {
    return failure(
      issue("FORA_DO_EXPEDIENTE", "data", "Escolha um horário dentro do funcionamento da banca."),
    );
  }

  const horario = horarios.find((item) => item.diaSemana === data.getDay());
  return horario
    ? success(horario)
    : failure(issue("HORARIO_NAO_CONFIGURADO", "horarios", "Não há horário configurado para este dia."));
}

/** Valida a sintaxe de um horário aproximado opcional (HH:mm). */
export function validarHorarioAproximado(
  horario: string | null,
): ValidationResult<string | null> {
  if (horario === null || horario === "") return success(null);
  if (parseHora(horario) === null) {
    return failure(
      issue("HORARIO_INVALIDO", "horarioAproximado", "Informe o horário no formato HH:mm."),
    );
  }
  return success(horario);
}

/** Valida os sete dias para evitar horários duplicados ou dias abertos incompletos. */
export function validarConfiguracaoHorarios(
  horarios: readonly HorarioFuncionamento[],
): ValidationResult<readonly HorarioFuncionamento[]> {
  const issues: ValidationIssue[] = [];
  if (horarios.length !== 7) {
    issues.push(
      issue("SEMANA_INCOMPLETA", "horarios", "Configure um registro para cada dia da semana."),
    );
  }

  const dias = new Set<number>();
  horarios.forEach((horario, index) => {
    if (!Number.isInteger(horario.diaSemana) || horario.diaSemana < 0 || horario.diaSemana > 6) {
      issues.push(
        issue("DIA_SEMANA_INVALIDO", "horarios[" + index + "].diaSemana", "O dia da semana deve ficar entre 0 e 6."),
      );
    } else if (dias.has(horario.diaSemana)) {
      issues.push(
        issue("DIA_DUPLICADO", "horarios[" + index + "].diaSemana", "Há mais de um horário para o mesmo dia."),
      );
    } else {
      dias.add(horario.diaSemana);
    }

    if (horario.fechado) {
      if (horario.abre !== null || horario.fecha !== null) {
        issues.push(
          issue("DIA_FECHADO_COM_HORARIO", "horarios[" + index + "]", "Um dia fechado deve ter abertura e fechamento vazios."),
        );
      }
      return;
    }

    const abre = horario.abre === null ? null : parseHora(horario.abre);
    const fecha = horario.fecha === null ? null : parseHora(horario.fecha);
    if (abre === null || fecha === null || fecha <= abre) {
      issues.push(
        issue("HORARIO_INVALIDO", "horarios[" + index + "]", "Informe horários válidos com fechamento após a abertura."),
      );
    }
  });

  return issues.length > 0
    ? failure(...issues)
    : success(horarios);
}