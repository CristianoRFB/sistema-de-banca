import { afterEach, describe, expect, it, vi } from "vitest";
import { clienteRepository } from "../../src/features/cliente/cliente.repository";
import { reservaRepository } from "../../src/features/reservas/reserva.repository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client API response contracts", () => {
  it("maps the wrapped profile response after editing the customer profile", async () => {
    let sentHeaders: Headers | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { profile: { clientId: "client-1", name: "Ana Maria", phone: "5517999991234", maskedPhone: "••••-1234" } },
        }),
      } as unknown as Response;
    }));

    await expect(clienteRepository.updateMyProfile("session-token", { nome: "Ana Maria", telefone: "(17) 99999-1234" }))
      .resolves.toEqual({ clienteId: "client-1", nome: "Ana Maria" });
    expect(sentHeaders?.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("sends the intent field the Worker validates and maps its full reservation response", async () => {
    let sentHeaders: Headers | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "reservation-1",
            status: "ATIVA",
            createdAt: "2026-09-29T12:00:00.000Z",
            desiredDate: "2026-09-30T15:00:00.000Z",
            desiredTime: "12:00",
            expiresAt: "2026-10-01T15:00:00.000Z",
            pickupIntent: "ESTOU_INDO",
            items: [{ id: "reservation-item-1", itemReparteId: "stock-1", title: "Wistoria", volume: "09", quantity: 1, quantityWithdrawn: 0 }],
          },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reservaRepository.setIntent("session-token", "reservation-1", "ESTOU_INDO");

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ intent: "ESTOU_INDO" });
    expect(sentHeaders?.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result).toMatchObject({
      id: "reservation-1",
      intencaoRetirada: "ESTOU_INDO",
      itens: [{ titulo: "Wistoria", volume: "09", quantidade: 1 }],
    });
  });
});
