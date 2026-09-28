import { compare, eq, firestoreString, query } from "../api";
import { currentLocalClock, defaultOpeningHours, localDateString } from "../domain";
import { FirestoreRest } from "../firebase/firestore-rest";
import type { Bindings, JsonObject } from "../types";

type Reminder = { phase: string; title: string; message: string; target: "CLIENTE" | "ADMIN"; marker: string };

function minutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function saoPauloWallTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const observed = Date.UTC(
      Number(parts.find((part) => part.type === "year")?.value),
      Number(parts.find((part) => part.type === "month")?.value) - 1,
      Number(parts.find((part) => part.type === "day")?.value),
      Number(parts.find((part) => part.type === "hour")?.value),
      Number(parts.find((part) => part.type === "minute")?.value),
    );
    guess += target - observed;
  }
  return new Date(guess);
}

function weekday(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function weekdayFromStored(value: unknown): number | null {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 6) return number;
  const name = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const index = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"].indexOf(name);
  return index < 0 ? null : index;
}

function makeReminders(reservation: JsonObject, now: Date, opening: string | null, closing: string | null): Reminder[] {
  const reminders: Reminder[] = [];
  const createdAt = new Date(String(reservation.criadaEm ?? ""));
  const expiresAt = new Date(String(reservation.expiraEm ?? ""));
  if (Number.isFinite(createdAt.getTime()) && Number.isFinite(expiresAt.getTime()) && expiresAt > createdAt) {
    const midpoint = createdAt.getTime() + (expiresAt.getTime() - createdAt.getTime()) / 2;
    if (now.getTime() >= midpoint && reservation.lembreteMeioEnviado !== true) reminders.push({
      phase: "MEIO_PRAZO", marker: "lembreteMeioEnviado", target: "CLIENTE", title: "Lembrete da sua reserva",
      message: "Sua reserva ainda está ativa. Confira o prazo e avise se precisar alterar a retirada.",
    });
  }
  const pickup = new Date(String(reservation.dataRetiradaPretendida ?? ""));
  if (!Number.isFinite(pickup.getTime())) return reminders;
  const date = localDateString(pickup);
  if (localDateString(now) !== date) return reminders;
  const current = currentLocalClock(now);
  const currentMinutes = current.hour * 60 + current.minute;
  const openMinutes = minutes(opening);
  const closeMinutes = minutes(closing);
  if (openMinutes !== null && currentMinutes >= openMinutes && reservation.lembreteDiaEnviado !== true) reminders.push({
    phase: "DIA_RETIRADA", marker: "lembreteDiaEnviado", target: "CLIENTE", title: "Sua retirada é hoje",
    message: "Sua reserva está prevista para hoje. Consulte o horário da banca e sua reserva no aplicativo.",
  });
  if (typeof reservation.horarioAproximado === "string" && minutes(reservation.horarioAproximado) !== null && reservation.lembreteHorarioEnviado !== true) {
    const pickupMoment = saoPauloWallTime(date, reservation.horarioAproximado);
    if (now.getTime() >= pickupMoment.getTime() - 30 * 60_000 && now.getTime() <= pickupMoment.getTime() + 30 * 60_000) reminders.push({
      phase: "HORARIO_RETIRADA", marker: "lembreteHorarioEnviado", target: "CLIENTE", title: "Horário aproximado da retirada",
      message: "Sua retirada está próxima do horário aproximado informado. Atualize sua intenção se necessário.",
    });
  }
  if (closeMinutes !== null && currentMinutes >= closeMinutes - 120 && currentMinutes < closeMinutes && reservation.lembreteFechamentoEnviado !== true) reminders.push({
    phase: "DUAS_HORAS_FECHAMENTO", marker: "lembreteFechamentoEnviado", target: "CLIENTE", title: "A banca fecha em breve",
    message: "Sua reserva ainda está pendente. Avise se vai buscar ou se precisa cancelar.",
  });
  if (closeMinutes !== null && currentMinutes >= closeMinutes - 30 && currentMinutes < closeMinutes &&
      reservation.intencaoRetirada !== "VOU_BUSCAR" && reservation.intencaoRetirada !== "ESTOU_INDO" && reservation.lembreteAdminFechamentoEnviado !== true) reminders.push({
    phase: "ADMIN_FECHAMENTO", marker: "lembreteAdminFechamentoEnviado", target: "ADMIN", title: "Retirada pendente perto do fechamento",
    message: `A reserva de ${String(reservation.clienteNomeSnapshot ?? "cliente")} continua pendente para hoje.`,
  });
  return reminders;
}

export async function processReminders(db: FirestoreRest, env: Bindings, now = new Date()): Promise<number> {
  const [bank, schedules, reservations] = await Promise.all([
    db.get(`bancas/${env.BANCA_ID}`),
    db.query(`bancas/${env.BANCA_ID}/horarios`, query("horarios", [], 7)),
    db.query("reservas", query("reservas", [
      eq("bancaId", firestoreString(env.BANCA_ID)),
      { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [firestoreString("ATIVA"), firestoreString("PARCIALMENTE_RETIRADA")] } } },
      compare("expiraEm", "GREATER_THAN", firestoreString(now.toISOString())),
    ], 200, [{ field: { fieldPath: "expiraEm" }, direction: "ASCENDING" }])),
  ]);
  if (!bank) return 0;
  let sent = 0;
  for (const candidate of reservations) {
    const pickup = new Date(String(candidate.data.dataRetiradaPretendida ?? ""));
    if (!Number.isFinite(pickup.getTime())) continue;
    const day = weekday(localDateString(pickup));
    const schedule = schedules.find((entry) => weekdayFromStored(entry.data.diaSemana) === day);
    const hours = schedule?.data ?? defaultOpeningHours(day);
    if (hours.fechado === true || hours.ativo === false) continue;
    const opening = String(hours.abre ?? hours.horaAbertura ?? "");
    const closing = String(hours.fecha ?? hours.horaFechamento ?? "");
    const due = makeReminders(candidate.data, now, opening, closing);
    if (!due.length) continue;
    const version = Number(candidate.data.agendaVersao ?? 0);
    const wasProcessed = await db.transact(async (transaction) => {
      const reservation = await transaction.get(`reservas/${candidate.id}`);
      if (!reservation || reservation.data.bancaId !== env.BANCA_ID ||
          !["ATIVA", "PARCIALMENTE_RETIRADA"].includes(String(reservation.data.status)) ||
          Number(reservation.data.agendaVersao ?? 0) !== version || reservation.data.dataRetiradaPretendida !== candidate.data.dataRetiradaPretendida) return false;
      const pending = due.filter((reminder) => reservation.data[reminder.marker] !== true);
      if (!pending.length) return false;
      const prepared = await Promise.all(pending.map(async (reminder) => {
        const id = `rem-${candidate.id}-${reminder.phase.toLowerCase()}-v${version}`;
        const existing = await transaction.get(`notificacoes/${id}`);
        return { reminder, id, exists: Boolean(existing) };
      }));
      const nowIso = now.toISOString();
      const updated: JsonObject = { ...reservation.data, atualizadaEm: nowIso };
      for (const { reminder, id, exists } of prepared) {
        updated[reminder.marker] = true;
        if (exists) continue;
        transaction.set(`notificacoes/${id}`, {
          bancaId: env.BANCA_ID,
          clienteId: reminder.target === "CLIENTE" ? reservation.data.clienteId ?? null : null,
          reservaId: candidate.id,
          destinatarioTipo: reminder.target,
          tipo: reminder.phase,
          titulo: reminder.title,
          mensagem: reminder.message,
          agendadaPara: null,
          enviadaEm: nowIso,
          criadaEm: nowIso,
          lida: false,
          status: "ENVIADA",
          agendaVersao: version,
        }, { mustNotExist: true });
      }
      transaction.set(`reservas/${candidate.id}`, updated);
      return prepared.filter((item) => !item.exists).length > 0;
    });
    if (wasProcessed) sent += due.length;
  }
  return sent;
}
