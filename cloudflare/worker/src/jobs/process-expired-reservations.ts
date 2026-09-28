import { assertInventoryValid, reservationAvailability } from "../domain";
import { catalogRowsForStocks, compare, eq, firestoreString, query, setCatalogAvailability } from "../api";
import { FirestoreRest } from "../firebase/firestore-rest";
import type { Bindings, FirestoreDocument, JsonObject } from "../types";

const OPEN_ITEM_STATUSES = new Set(["RESERVADO", "RETIRADA_INFORMADA"]);

export async function processExpiredReservations(db: FirestoreRest, env: Bindings, now = new Date()): Promise<number> {
  const due = await db.query("reservas", query("reservas", [
    eq("bancaId", firestoreString(env.BANCA_ID)),
    { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [firestoreString("ATIVA"), firestoreString("PARCIALMENTE_RETIRADA")] } } },
    compare("expiraEm", "LESS_THAN_OR_EQUAL", firestoreString(now.toISOString())),
  ], 100, [{ field: { fieldPath: "expiraEm" }, direction: "ASCENDING" }]));
  let expired = 0;

  for (const candidate of due) {
    const didExpire = await db.transact(async (transaction) => {
      const reservation = await transaction.get(`reservas/${candidate.id}`);
      if (!reservation || reservation.data.bancaId !== env.BANCA_ID ||
          !["ATIVA", "PARCIALMENTE_RETIRADA"].includes(String(reservation.data.status)) ||
          Date.parse(String(reservation.data.expiraEm ?? "")) > now.getTime()) return false;
      const items = await transaction.query("itensReserva", query("itensReserva", [eq("reservaId", firestoreString(candidate.id))], 100));
      const openItems = items.filter((item) => OPEN_ITEM_STATUSES.has(String(item.data.status)));
      const inventory = new Map<string, FirestoreDocument>();
      for (const item of openItems) {
        const itemReparteId = String(item.data.itemReparteId ?? "");
        if (!inventory.has(itemReparteId)) {
          const stock = await transaction.get(`itensReparte/${itemReparteId}`);
          if (!stock || stock.data.bancaId !== env.BANCA_ID) throw new Error("Expired reservation stock record is missing.");
          inventory.set(itemReparteId, stock);
        }
      }
      const catalogRows = await catalogRowsForStocks(transaction, env, [...inventory.keys()]);
      const notificationPath = `notificacoes/expiry-${candidate.id}`;
      const notification = await transaction.get(notificationPath);
      const changedInventory = new Map<string, JsonObject>();
      const itemUpdates: Array<{ item: FirestoreDocument; quantity: number }> = [];
      const movements: Array<{ itemReparteId: string; itemReservationId: string; quantity: number; before: number; after: number }> = [];
      for (const item of openItems) {
        const itemReparteId = String(item.data.itemReparteId);
        const stock = inventory.get(itemReparteId)!;
        const current = changedInventory.get(itemReparteId) ?? stock.data;
        const quantity = Number(item.data.quantidade ?? 0);
        const reserved = Number(current.quantidadeReservada ?? 0);
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || reserved < quantity) throw new Error("Expired reservation stock balance is inconsistent.");
        const updated = { ...current, quantidadeReservada: reserved - quantity, atualizadoEm: now.toISOString() };
        assertInventoryValid(updated);
        changedInventory.set(itemReparteId, updated);
        itemUpdates.push({ item, quantity });
        movements.push({ itemReparteId, itemReservationId: item.id, quantity, before: reservationAvailability(current), after: reservationAvailability(updated) });
      }
      for (const { item } of itemUpdates) transaction.set(`itensReserva/${item.id}`, { ...item.data, status: "EXPIRADO", expiradoEm: now.toISOString() });
      for (const movement of movements) {
        const movementId = crypto.randomUUID();
        transaction.set(`movimentacoesEstoque/${movementId}`, {
          bancaId: env.BANCA_ID,
          itemReparteId: movement.itemReparteId,
          itemReservaId: movement.itemReservationId,
          tipo: "CANCELAMENTO",
          quantidade: movement.quantity,
          saldoAntes: movement.before,
          saldoDepois: movement.after,
          motivo: "Reserva expirada automaticamente",
          criadoEm: now.toISOString(),
          usuarioId: null,
        }, { mustNotExist: true });
      }
      for (const [itemReparteId, stock] of changedInventory) transaction.set(`itensReparte/${itemReparteId}`, stock);
      setCatalogAvailability(transaction, catalogRows, new Map([...changedInventory].map(([id, stock]) => [id, reservationAvailability(stock)])), now.toISOString());
      transaction.set(`reservas/${candidate.id}`, { ...reservation.data, status: "EXPIRADA", atualizadaEm: now.toISOString() });
      if (!notification) transaction.set(notificationPath, {
        bancaId: env.BANCA_ID,
        clienteId: reservation.data.clienteId ?? null,
        reservaId: candidate.id,
        destinatarioTipo: "CLIENTE",
        tipo: "RESERVA_EXPIRADA",
        titulo: "Reserva encerrada",
        mensagem: "O prazo da sua reserva terminou e os itens voltaram a ficar disponíveis.",
        agendadaPara: null,
        enviadaEm: now.toISOString(),
        criadaEm: now.toISOString(),
        lida: false,
        status: "ENVIADA",
      }, { mustNotExist: true });
      return true;
    });
    if (didExpire) expired += 1;
  }
  return expired;
}
