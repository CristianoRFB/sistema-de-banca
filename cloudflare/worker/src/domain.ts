import { HttpError, type JsonObject } from "./types";

export const MAX_RESERVATION_DAYS = 9;
export const MAX_RESERVATION_ITEMS = 20;
export const MAX_CATALOG_PAGE_SIZE = 50;

export function defaultOpeningHours(dayOfWeek: number): JsonObject {
  const closed = dayOfWeek === 0;
  return {
    diaSemana: dayOfWeek,
    fechado: closed,
    abre: closed ? null : "08:00",
    fecha: dayOfWeek === 6 ? "13:00" : closed ? null : "18:00",
    ativo: true,
  };
}

export interface PickupWindow {
  pickupAt: Date;
  expiresAt: Date;
}

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new HttpError({ code: "invalid_request", message: `${field} is required.`, status: 400 });
  const result = value.trim();
  if (!result || result.length > maxLength) throw new HttpError({ code: "invalid_request", message: `${field} is invalid.`, status: 400 });
  return result;
}

export function requirePositiveInteger(value: unknown, field: string, maxValue = 999): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maxValue) {
    throw new HttpError({ code: "invalid_request", message: `${field} must be a positive whole number.`, status: 400 });
  }
  return parsed;
}

function localDateParts(date = new Date()): { year: number; month: number; day: number } {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(values.find((value) => value.type === "year")?.value),
    month: Number(values.find((value) => value.type === "month")?.value),
    day: Number(values.find((value) => value.type === "day")?.value),
  };
}

function localClock(date: Date): { hour: number; minute: number } {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    hour: Number(values.find((value) => value.type === "hour")?.value),
    minute: Number(values.find((value) => value.type === "minute")?.value),
  };
}

export function localDateString(date = new Date()): string {
  const parts = localDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseDate(date: unknown): { year: number; month: number; day: number; weekday: number; date: string } {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpError({ code: "invalid_pickup_date", message: "desiredDate must use YYYY-MM-DD.", status: 400 });
  }
  const [year, month, day] = date.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) {
    throw new HttpError({ code: "invalid_pickup_date", message: "desiredDate is not a calendar date.", status: 400 });
  }
  return { year, month, day, weekday: normalized.getUTCDay(), date };
}

function localDateTimeToUtc(date: string, time: string): Date {
  const { year, month, day } = parseDate(date);
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new HttpError({ code: "invalid_pickup_time", message: "The bank opening hours are invalid.", status: 500 });
  }
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetWallClock;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const dateAtGuess = new Date(guess);
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(dateAtGuess);
    const actualWallClock = Date.UTC(
      Number(local.find((part) => part.type === "year")?.value),
      Number(local.find((part) => part.type === "month")?.value) - 1,
      Number(local.find((part) => part.type === "day")?.value),
      Number(local.find((part) => part.type === "hour")?.value),
      Number(local.find((part) => part.type === "minute")?.value),
    );
    guess += targetWallClock - actualWallClock;
  }
  return new Date(guess);
}

function addDays(date: string, amount: number): string {
  const { year, month, day } = parseDate(date);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function timeMinutes(value: unknown): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function validatePickupWindow(args: {
  now: Date;
  desiredDate: unknown;
  desiredTime?: unknown;
  schedule: JsonObject | null;
  bank: JsonObject;
  reservationCutoffs: Array<Date | null>;
}): PickupWindow {
  const parsedDate = parseDate(args.desiredDate);
  const today = localDateString(args.now);
  if (parsedDate.date < today) throw new HttpError({ code: "pickup_date_in_past", message: "The pickup date must be today or later.", status: 400 });
  const desiredTime = typeof args.desiredTime === "string" && args.desiredTime.trim() ? args.desiredTime.trim() : null;
  const schedule = args.schedule;
  if (!schedule || schedule.fechado === true || schedule.ativo === false) {
    throw new HttpError({ code: "bank_closed", message: "The bank is closed on the selected day.", status: 400 });
  }
  const opening = timeMinutes(schedule.abre ?? schedule.horaAbertura);
  const closing = timeMinutes(schedule.fecha ?? schedule.horaFechamento);
  if (opening === null || closing === null || closing <= opening) {
    throw new HttpError({ code: "bank_hours_unavailable", message: "Opening hours are not configured for the selected day.", status: 409 });
  }
  const requestedMinutes = desiredTime ? timeMinutes(desiredTime) : closing;
  if (requestedMinutes === null || requestedMinutes < opening || requestedMinutes > closing) {
    throw new HttpError({ code: "outside_opening_hours", message: "The selected pickup time is outside opening hours.", status: 400 });
  }
  const pickupAt = localDateTimeToUtc(parsedDate.date, `${String(Math.floor(requestedMinutes / 60)).padStart(2, "0")}:${String(requestedMinutes % 60).padStart(2, "0")}`);
  const maxPickupAt = new Date(args.now.getTime() + MAX_RESERVATION_DAYS * 86_400_000);
  if (pickupAt.getTime() > maxPickupAt.getTime()) {
    throw new HttpError({ code: "pickup_too_far", message: "Pickup can be scheduled no more than 9 days after reservation.", status: 400 });
  }

  const cutoff = args.reservationCutoffs.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .reduce<Date | null>((earliest, value) => !earliest || value < earliest ? value : earliest, null);
  if (cutoff && pickupAt.getTime() > cutoff.getTime()) {
    throw new HttpError({ code: "reservations_closed", message: "At least one selected item can no longer be reserved for that pickup date.", status: 409 });
  }

  const tolerance = Number(args.bank.toleranciaRetiradaDias ?? 0);
  const toleranceDays = Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 30 ? tolerance : 0;
  const closeDate = addDays(parsedDate.date, toleranceDays);
  const expiresAt = localDateTimeToUtc(closeDate, `${String(Math.floor(closing / 60)).padStart(2, "0")}:${String(closing % 60).padStart(2, "0")}`);
  const hardExpiry = new Date(args.now.getTime() + MAX_RESERVATION_DAYS * 86_400_000);
  if (expiresAt.getTime() > hardExpiry.getTime()) expiresAt.setTime(hardExpiry.getTime());
  if (expiresAt.getTime() <= args.now.getTime()) {
    throw new HttpError({ code: "pickup_expired", message: "The selected pickup date has already passed.", status: 400 });
  }
  return { pickupAt, expiresAt };
}

export function reservationAvailability(item: JsonObject): number {
  const received = Number(item.quantidadeRecebida ?? 0);
  const reserved = Number(item.quantidadeReservada ?? 0);
  const withdrawn = Number(item.quantidadeRetirada ?? 0);
  const returned = Number(item.quantidadeDevolvida ?? 0);
  const positive = Number(item.quantidadeAjustePositivo ?? 0);
  const negative = Number(item.quantidadeAjusteNegativo ?? 0);
  return received + positive - reserved - withdrawn - returned - negative;
}

export function assertInventoryValid(item: JsonObject): void {
  const available = reservationAvailability(item);
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new HttpError({ code: "inventory_invariant_failed", message: "The inventory balance is inconsistent; an administrator must reconcile it.", status: 409 });
  }
}

export function localWeekday(date: string): number {
  return parseDate(date).weekday;
}

export function currentLocalClock(date: Date): { hour: number; minute: number } {
  return localClock(date);
}
