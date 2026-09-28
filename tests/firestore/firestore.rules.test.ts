import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, it } from "vitest";

describe("Firestore rules", () => {
  let testEnvironment: Awaited<ReturnType<typeof initializeTestEnvironment>>;

  beforeAll(async () => {
    testEnvironment = await initializeTestEnvironment({
      projectId: "banca-88851",
      firestore: {
        rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
      },
    });
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  it("denies unauthenticated reads of public and private collections", async () => {
    const db = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(db.doc("bancas/banca-principal").get());
    await assertFails(db.doc("clientes/client-1").get());
    await assertFails(db.doc("itensLista/item-1").get());
    await assertFails(db.doc("reservas/reservation-1").get());
  });

  it("denies browser writes even for signed-in clients and admins", async () => {
    const clientDb = testEnvironment.authenticatedContext("client-1").firestore();
    const adminDb = testEnvironment.authenticatedContext("admin-1", { role: "ADMIN" }).firestore();
    await assertFails(clientDb.doc("clientes/client-1").set({ nome: "Cliente" }));
    await assertFails(clientDb.doc("reservas/reservation-1").set({ clienteId: "client-1" }));
    await assertFails(adminDb.doc("listas/list-1").set({ status: "PUBLICADA" }));
  });
});
