import { describe, expect, it } from 'vitest';
import { getAdminReservations } from '../../cloudflare/worker/src/routes/admin';
import type { Bindings, FirestoreDocument, RequestContext } from '../../cloudflare/worker/src/types';

const env: Bindings = {
  FIREBASE_PROJECT_ID: 'admin-reservations-test',
  BANCA_ID: 'test-bank',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  CLIENT_SESSION_PEPPER: 'admin-cursor-test-pepper-more-than-32-bytes',
  CORS_ORIGINS: 'https://example.test',
};

function doc(id: string, data: Record<string, unknown>): FirestoreDocument {
  return { id, name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/reservas/${id}`, data };
}

function context(url: string, seenQueries: Array<{ collection: string; query: Record<string, unknown> }>): RequestContext {
  const db = {
    async query(collection: string, query: Record<string, unknown>) {
      seenQueries.push({ collection, query });
      if (collection === 'reservas') return [
        doc('reservation-a', { bancaId: env.BANCA_ID, status: 'ATIVA', clienteId: 'client-a', criadaEm: '2026-09-28T10:00:00.000Z', dataRetiradaPretendida: '2026-09-29T11:00:00.000Z' }),
        doc('reservation-b', { bancaId: env.BANCA_ID, status: 'PARCIALMENTE_RETIRADA', clienteId: 'client-b', criadaEm: '2026-09-28T09:00:00.000Z', dataRetiradaPretendida: '2026-09-29T12:00:00.000Z' }),
      ];
      return [];
    },
    async batchGet() { return new Map(); },
  } as unknown as RequestContext['db'];
  return {
    request: new Request(`https://api.example.test/api/admin/reservations${url}`),
    url: new URL(`https://api.example.test/api/admin/reservations${url}`),
    env,
    db,
    corsOrigin: null,
  };
}

describe('admin reservation date filter', () => {
  it('filters by Sao Paulo day and active reservation statuses, and signs pagination cursors to that scope', async () => {
    const queries: Array<{ collection: string; query: Record<string, unknown> }> = [];
    const response = await getAdminReservations(context('?date=2026-09-29&limit=1', queries));
    const body = await response.json() as { data: { reservations: unknown[]; page: { nextCursor: string } } };
    const firestoreQuery = queries.find((entry) => entry.collection === 'reservas')?.query;
    expect(firestoreQuery).toBeDefined();
    expect(JSON.stringify(firestoreQuery)).toContain('GREATER_THAN_OR_EQUAL');
    expect(JSON.stringify(firestoreQuery)).toContain('LESS_THAN');
    expect(JSON.stringify(firestoreQuery)).toContain('PARCIALMENTE_RETIRADA');
    expect(body.data.reservations).toHaveLength(1);
    expect(body.data.page.nextCursor).toBeTruthy();

    const cursor = body.data.page.nextCursor;
    const nextQueries: Array<{ collection: string; query: Record<string, unknown> }> = [];
    await getAdminReservations(context(`?date=2026-09-29&limit=1&cursor=${encodeURIComponent(cursor)}`, nextQueries));
    expect(JSON.stringify(nextQueries[0].query)).toContain('startAt');

    await expect(getAdminReservations(context(`?date=2026-09-30&limit=1&cursor=${encodeURIComponent(cursor)}`, [])))
      .rejects.toMatchObject({ code: 'invalid_cursor', status: 400 });
  });

  it('rejects impossible calendar dates before querying Firestore', async () => {
    const queries: Array<{ collection: string; query: Record<string, unknown> }> = [];
    await expect(getAdminReservations(context('?date=2026-02-31', queries)))
      .rejects.toMatchObject({ code: 'invalid_date', status: 400 });
    expect(queries).toHaveLength(0);
  });
});
