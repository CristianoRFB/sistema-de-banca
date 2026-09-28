import { eq, firestoreString, query } from "../api";
import { localDateString } from "../domain";
import { FirestoreRest } from "../firebase/firestore-rest";
import type { Bindings } from "../types";

function daysBetween(today: string, due: string): number {
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const [dueYear, dueMonth, dueDay] = due.split("-").map(Number);
  return Math.round((Date.UTC(dueYear, dueMonth - 1, dueDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000);
}

function dueLocalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  return localDateString(date);
}

export async function processRecollections(db: FirestoreRest, env: Bindings, now = new Date()): Promise<number> {
  const repartes = await db.query("repartes", query("repartes", [
    eq("bancaId", firestoreString(env.BANCA_ID)),
    eq("status", firestoreString("ATIVO")),
  ], 200, [{ field: { fieldPath: "dataRecolhimentoPrevista" }, direction: "ASCENDING" }]));
  const today = localDateString(now);
  let changed = 0;

  for (const candidate of repartes) {
    const dueDate = dueLocalDate(candidate.data.dataRecolhimentoPrevista);
    if (!dueDate) continue;
    const daysRemaining = daysBetween(today, dueDate);
    if (daysRemaining > 7) continue;
    const reminderOffsets = daysRemaining === 0 ? [0] : daysRemaining <= 2 ? [2] : [7];
    const becameDue = daysRemaining <= 0;
    const didProcess = await db.transact(async (transaction) => {
      const reparte = await transaction.get(`repartes/${candidate.id}`);
      if (!reparte || reparte.data.bancaId !== env.BANCA_ID || reparte.data.status !== "ATIVO") return false;
      const collectionId = `reparte-${candidate.id}`;
      const collection = await transaction.get(`recolhimentos/${collectionId}`);
      const reminders = await Promise.all(reminderOffsets.map(async (offset) => {
        const id = `reparte-${candidate.id}-recolhimento-${offset}`;
        const existing = await transaction.get(`notificacoes/${id}`);
        return { id, offset, exists: Boolean(existing) };
      }));
      const nowIso = now.toISOString();
      for (const reminder of reminders) {
        if (reminder.exists) continue;
        transaction.set(`notificacoes/${reminder.id}`, {
          bancaId: env.BANCA_ID,
          clienteId: null,
          reservaId: null,
          reparteId: candidate.id,
          destinatarioTipo: "ADMIN",
          tipo: `RECOLHIMENTO_${reminder.offset}_DIAS`,
          titulo: reminder.offset === 0 ? "Recolhimento previsto para hoje" : `Recolhimento previsto em ${reminder.offset} dias`,
          mensagem: `O reparte ${String(reparte.data.titulo ?? candidate.id)} deve ser conferido em ${dueDate}.`,
          agendadaPara: null,
          enviadaEm: nowIso,
          criadaEm: nowIso,
          lida: false,
          status: "ENVIADA",
        }, { mustNotExist: true });
      }
      if (!collection && becameDue) transaction.set(`recolhimentos/${collectionId}`, {
        bancaId: env.BANCA_ID,
        reparteId: candidate.id,
        dataPrevista: reparte.data.dataRecolhimentoPrevista,
        iniciadoEm: null,
        confirmadoEm: null,
        status: "PENDENTE",
        observacoes: null,
      }, { mustNotExist: true });
      if (becameDue) transaction.set(`repartes/${candidate.id}`, {
        ...reparte.data,
        status: "AGUARDANDO_RECOLHIMENTO",
        aguardandoRecolhimentoEm: nowIso,
      });
      return reminders.some((item) => !item.exists) || becameDue;
    });
    if (didProcess) changed += 1;
  }
  return changed;
}
