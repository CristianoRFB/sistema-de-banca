import type { HorarioFuncionamento } from "../entities/HorarioFuncionamento";
import { calcularFimReservas } from "./calcularFimReservas";
import { DURACAO_MAXIMA_RESERVA_MS } from "./calcularExpiracaoReserva";
import {
  obterJanelaFuncionamento,
  validarHorarioAproximado,
  validarHorarioBanca,
} from "./validarHorarioBanca";
import { failure, issue, success } from "../validation";
import type { ValidationIssue, ValidationResult } from "../validation";

export interface ContextoDataRetirada {
  agora: Date;
  criadaEm: Date;
  dataRetiradaPretendida: Date;
  horarioAproximado?: string | null;
  horarios: readonly HorarioFuncionamento[];
  dataFimReservas?: Date | null;
  dataRecolhimento?: Date | null;
  margemSegurancaDias?: number;
}

function inicioDoDia(data: Date): Date {
  const inicio = new Date(data.getTime());
  inicio.setHours(0, 0, 0, 0);
  return inicio;
}

export function validarDataRetirada(
  contexto: ContextoDataRetirada,
): ValidationResult<Date> {
  const { agora, criadaEm, dataRetiradaPretendida: retirada } = contexto;
  if (
    !Number.isFinite(agora.getTime()) ||
    !Number.isFinite(criadaEm.getTime()) ||
    !Number.isFinite(retirada.getTime())
  ) {
    return failure(issue("DATA_INVALIDA", "dataRetiradaPretendida", "Informe datas válidas."));
  }

  const issues: ValidationIssue[] = [];
  const aproximado = validarHorarioAproximado(
    contexto.horarioAproximado ?? null,
  );
  if (!aproximado.ok) issues.push(...aproximado.issues);

  const diaEscolhido = inicioDoDia(retirada);
  const hoje = inicioDoDia(agora);
  if (diaEscolhido.getTime() < hoje.getTime()) {
    issues.push(
      issue("RETIRADA_NO_PASSADO", "dataRetiradaPretendida", "A retirada deve ser marcada para hoje ou uma data futura."),
    );
  }

  const janela = obterJanelaFuncionamento(diaEscolhido, contexto.horarios);
  if (!janela.ok) issues.push(...janela.issues);

  let dataHoraComparada = new Date(diaEscolhido.getTime());
  if (aproximado.ok && aproximado.value) {
    const [hora, minuto] = aproximado.value.split(":").map(Number);
    dataHoraComparada.setHours(hora, minuto, 0, 0);
    if (janela.ok) {
      const horario = validarHorarioBanca(dataHoraComparada, contexto.horarios);
      if (!horario.ok) issues.push(...horario.issues);
    }
    if (dataHoraComparada.getTime() <= agora.getTime()) {
      issues.push(
        issue("RETIRADA_NO_PASSADO", "horarioAproximado", "O horário aproximado precisa estar no futuro."),
      );
    }
  } else if (janela.ok) {
    dataHoraComparada = new Date(janela.value.abreEm.getTime());
    if (diaEscolhido.getTime() === hoje.getTime() && agora.getTime() > dataHoraComparada.getTime()) {
      dataHoraComparada = new Date(agora.getTime());
    }
    if (dataHoraComparada.getTime() >= janela.value.fechaEm.getTime()) {
      issues.push(
        issue("SEM_HORARIO_DISPONIVEL", "dataRetiradaPretendida", "Não há mais horário de funcionamento disponível nesse dia."),
      );
    }
  }

  const prazoMaximo = new Date(
    criadaEm.getTime() + DURACAO_MAXIMA_RESERVA_MS,
  );
  if (dataHoraComparada.getTime() > prazoMaximo.getTime()) {
    issues.push(
      issue("LIMITE_NOVE_DIAS", "dataRetiradaPretendida", "A retirada deve ocorrer dentro do limite de nove dias após a criação da reserva."),
    );
  }

  let fimReservas: Date | null;
  try {
    fimReservas =
      contexto.dataFimReservas ??
      calcularFimReservas(
        contexto.dataRecolhimento ?? null,
        contexto.margemSegurancaDias ?? 2,
      );
  } catch (error) {
    issues.push(
      issue(
        "LIMITE_RECOLHIMENTO_INVALIDO",
        "dataFimReservas",
        error instanceof Error ? error.message : "O limite de recolhimento é inválido.",
      ),
    );
    fimReservas = null;
  }
  if (fimReservas && !Number.isFinite(fimReservas.getTime())) {
    issues.push(
      issue("LIMITE_RECOLHIMENTO_INVALIDO", "dataFimReservas", "O limite de recolhimento é inválido."),
    );
    fimReservas = null;
  }
  if (fimReservas && dataHoraComparada.getTime() > fimReservas.getTime()) {
    issues.push(
      issue("APOS_FIM_DAS_RESERVAS", "dataRetiradaPretendida", "A data escolhida ultrapassa o limite definido para este lote."),
    );
  }

  return issues.length > 0 ? failure(...issues) : success(retirada);
}