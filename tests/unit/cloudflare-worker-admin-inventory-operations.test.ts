import { describe, expect, it } from 'vitest';
import { cancelReservationByAdmin, reconcileReparte } from '../../cloudflare/worker/src/routes/admin';
import type { AdminIdentity, Bindings, FirestoreDocument, RequestContext } from '../../cloudflare/worker/src/types';

const env: Bindings = {
  FIREBASE_PROJECT_ID: 'admin-inventory-test',
  BANCA_ID: 'test-bank',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  CLIENT_SESSION_PEPPER: 'admin-inventory-pepper-more-than-32-bytes',
  CORS_ORIGINS: 'https://example.test',
};

function document(path: string, data: Record<string, unknown>): FirestoreDocument {
  return {
    id: path.split('/').at(-1) ?? path,
    name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    data,
  };
}

class MemoryDb {
  readonly documents = new Map<string, FirestoreDocument>();

  async get(path: string) { return this.documents.get(path) ?? null; }

  async query(collection: string) {
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(`${collection}/`) && path.slice(collection.length + 1).includes('/') === false)
      .map(([, item]) => item);
  }

  async transact<T>(work: (transaction: {
    get: (path: string) => Promise<FirestoreDocument | null>;
    query: (collection: string, query: Record<string, unknown>) => Promise<FirestoreDocument[]>;
    set: (path: string, data: Record<string, unknown>, options?: { mustNotExist?: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    return work({
      get: async (path) => this.get(path),
      query: async (collection) => this.query(collection),
      set: (path, data, options) => {
        if (options?.mustNotExist && this.documents.has(path)) throw new Error(`Document already exists: ${path}`);
        this.documents.set(path, document(path, data));
      },
    });
  }
}

function context(db: MemoryDb, path: string, body: unknown, key: string): RequestContext {
  const url = new URL(`https://api.example.test${path}`);
  return {
    request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }),
    url,
    env,
    db: db as unknown as RequestContext['db'],
    corsOrigin: null,
  };
}

const admin: AdminIdentity = { uid: 'admin-1', role: 'ADMIN', claims: {} };

describe('admin inventory operations', () => {
  it('releases active stock and records a bank-initiated cancellation atomically', async () => {
    const db = new MemoryDb();
    db.documents.set('reservas/reservation-1', document('reservas/reservation-1', { bancaId: env.BANCA_ID, clienteId: 'client-1', status: 'ATIVA' }));
    db.documents.set('itensReserva/item-1', document('itensReserva/item-1', { reservaId: 'reservation-1', itemReparteId: 'stock-1', quantidade: 2, status: 'RESERVADO' }));
    db.documents.set('itensReparte/stock-1', document('itensReparte/stock-1', { bancaId: env.BANCA_ID, quantidadeRecebida: 4, quantidadeReservada: 2, quantidadeRetirada: 0, quantidadeDevolvida: 0, quantidadeAjustePositivo: 0, quantidadeAjusteNegativo: 0 }));

    const response = await cancelReservationByAdmin(context(db, '/api/admin/reservations/reservation-1/cancel', {}, 'cancel-key-001'), admin, 'reservation-1');
    const body = await response.json() as { data: { status: string; releasedQuantity: number } };

    expect(body.data).toMatchObject({ status: 'CANCELADA', releasedQuantity: 2 });
    expect(db.documents.get('itensReparte/stock-1')?.data.quantidadeReservada).toBe(0);
    expect(db.documents.get('itensReserva/item-1')?.data).toMatchObject({ status: 'CANCELADO_BANCA', canceladoPor: admin.uid });
    expect([...db.documents.values()].some((item) => item.name.includes('/movimentacoesEstoque/') && item.data.tipo === 'CANCELAMENTO')).toBe(true);
    expect([...db.documents.values()].some((item) => item.name.includes('/historicoAlteracoes/') && item.data.tipo === 'CANCELAMENTO_BANCA')).toBe(true);
  });

  it('leaves a shortage pending, then reconciles the remaining balance without losing the first return', async () => {
    const db = new MemoryDb();
    db.documents.set('repartes/reparte-1', document('repartes/reparte-1', { bancaId: env.BANCA_ID, status: 'ATIVO', dataRecolhimentoPrevista: '2026-09-30T00:00:00.000Z' }));
    db.documents.set('listas/list-1', document('listas/list-1', { bancaId: env.BANCA_ID, reparteId: 'reparte-1', status: 'PUBLICADA', versao: 1 }));
    db.documents.set('itensReparte/stock-1', document('itensReparte/stock-1', { bancaId: env.BANCA_ID, reparteId: 'reparte-1', produtoId: 'product-1', quantidadeRecebida: 3, quantidadeReservada: 0, quantidadeRetirada: 0, quantidadeDevolvida: 0, quantidadeAjustePositivo: 0, quantidadeAjusteNegativo: 0, status: 'DISPONIVEL' }));

    const pendingResponse = await reconcileReparte(context(db, '/api/admin/repartes/reparte-1/reconcile', {
      items: [{ itemReparteId: 'stock-1', quantityFound: 2, resolution: 'MANTER_PENDENTE', reason: 'Investigar diferença' }],
    }, 'reconcile-key-001'), admin, 'reparte-1');
    const pendingBody = await pendingResponse.json() as { data: { status: string } };
    expect(pendingBody.data.status).toBe('COM_DIVERGENCIA');
    expect(db.documents.get('repartes/reparte-1')?.data.status).toBe('AGUARDANDO_RECOLHIMENTO');
    expect(db.documents.get('itensReparte/stock-1')?.data.quantidadeDevolvida).toBe(2);
    expect(db.documents.get('itensReparte/stock-1')?.data.quantidadeAjusteNegativo).toBe(0);

    const pendingLine = db.documents.get('itensRecolhimento/reparte-reparte-1-stock-1')!;
    const pendingDivergenceId = String(pendingLine.data.divergenciaPendenteId);
    expect(db.documents.get(`divergencias/${pendingDivergenceId}`)?.data.resolvida).toBe(false);

    const resolvedResponse = await reconcileReparte(context(db, '/api/admin/repartes/reparte-1/reconcile', {
      items: [{ itemReparteId: 'stock-1', quantityFound: 0, resolution: 'PERDA_OU_AVARIA', reason: 'Avaria confirmada' }],
    }, 'reconcile-key-002'), admin, 'reparte-1');
    const resolvedBody = await resolvedResponse.json() as { data: { status: string } };

    expect(resolvedBody.data.status).toBe('CONFIRMADO');
    expect(db.documents.get(`divergencias/${pendingDivergenceId}`)?.data.resolvida).toBe(true);
    expect(db.documents.get('itensReparte/stock-1')?.data).toMatchObject({ quantidadeDevolvida: 2, quantidadeAjusteNegativo: 1 });
    expect(db.documents.get('repartes/reparte-1')?.data.status).toBe('ENCERRADO');
    expect(db.documents.get('listas/list-1')?.data.status).toBe('ENCERRADA');
  });
});
