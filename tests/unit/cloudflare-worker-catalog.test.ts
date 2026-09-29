import { describe, expect, it } from 'vitest';
import { handlePublicRoute } from '../../cloudflare/worker/src/routes/public';
import type { FirestoreRest } from '../../cloudflare/worker/src/firebase/firestore-rest';
import type { Bindings, FirestoreDocument, JsonObject, RequestContext } from '../../cloudflare/worker/src/types';

const projectId = 'catalog-test-project';
const bankId = 'catalog-test-bank';
const rateLimitCalls: string[] = [];

function doc(path: string, data: JsonObject): FirestoreDocument {
  return {
    id: path.split('/').at(-1) ?? '',
    name: `projects/${projectId}/databases/(default)/documents/${path}`,
    data,
  };
}

function scalar(value: JsonObject | undefined): unknown {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  return undefined;
}

class CatalogFirestore {
  private readonly documents = new Map<string, FirestoreDocument>();

  constructor(count = 60) {
    for (let number = 1; number <= count; number += 1) {
      const suffix = String(number).padStart(3, '0');
      const rowId = `row-${suffix}`;
      const listId = `list-${suffix}`;
      const stockId = `stock-${suffix}`;
      const productId = `product-${suffix}`;
      const reparteId = `reparte-${suffix}`;
      const target = number === 30 || number === 5;
      const available = number === 60 ? 2 : 8;
      const publishedAt = new Date(Date.UTC(2026, 8, number)).toISOString();
      this.documents.set(`itensLista/${rowId}`, doc(`itensLista/${rowId}`, {
        bancaId: bankId,
        listaId: listId,
        itemReparteId: stockId,
        produtoId: productId,
        tituloExibicao: target ? 'Histórias além da estação' : `Título ${suffix}`,
        volumeExibicao: null,
        publicadoEm: publishedAt,
        ativo: true,
        availabilityClass: available <= 3 ? 'LOW' : 'AVAILABLE',
      }));
      this.documents.set(`listas/${listId}`, doc(`listas/${listId}`, { bancaId: bankId, status: 'PUBLICADA', publicadaEm: publishedAt }));
      this.documents.set(`itensReparte/${stockId}`, doc(`itensReparte/${stockId}`, {
        bancaId: bankId,
        reparteId,
        produtoId: productId,
        status: 'DISPONIVEL',
        quantidadeRecebida: available,
        quantidadeReservada: 0,
        quantidadeRetirada: 0,
        quantidadeDevolvida: 0,
        quantidadeAjustePositivo: 0,
        quantidadeAjusteNegativo: 0,
      }));
      this.documents.set(`produtos/${productId}`, doc(`produtos/${productId}`, {
        tipo: target ? 'MANGA' : 'REVISTA',
        editora: number === 40 ? 'Editora Especial' : 'Editora Exemplo',
        ativo: true,
      }));
      this.documents.set(`repartes/${reparteId}`, doc(`repartes/${reparteId}`, { bancaId: bankId, status: 'ATIVO' }));
    }
  }

  async query(_collection: string, structuredQuery: JsonObject): Promise<FirestoreDocument[]> {
    const from = structuredQuery.from as Array<JsonObject> | undefined;
    const collectionId = String(from?.[0]?.collectionId ?? 'itensLista');
    const where = structuredQuery.where as JsonObject | undefined;
    const filters = 'fieldFilter' in (where ?? {})
      ? [where!.fieldFilter as JsonObject]
      : ((where?.compositeFilter as JsonObject | undefined)?.filters as Array<JsonObject> | undefined ?? []).map((entry) => entry.fieldFilter as JsonObject);
    let documents = [...this.documents.values()].filter((document) => document.name.includes(`/documents/${collectionId}/`));
    documents = documents.filter((document) => filters.every((filter) => {
      const field = (filter.field as JsonObject | undefined)?.fieldPath;
      const value = filter.value as JsonObject | undefined;
      if (typeof field !== 'string' || !value) return false;
      const actual = document.data[field];
      if (filter.op === 'EQUAL') return actual === scalar(value);
      if (filter.op === 'IN') {
        const values = ((value.arrayValue as JsonObject | undefined)?.values as JsonObject[] | undefined ?? []).map(scalar);
        return values.includes(actual);
      }
      return false;
    }));

    const orderBy = structuredQuery.orderBy as Array<JsonObject> | undefined ?? [];
    const getSortValue = (document: FirestoreDocument, field: string) => field === '__name__' ? document.id : String(document.data[field] ?? '');
    const compareDocuments = (left: FirestoreDocument, right: FirestoreDocument) => {
      for (const clause of orderBy) {
        const field = String((clause.field as JsonObject | undefined)?.fieldPath ?? '');
        const leftValue = getSortValue(left, field);
        const rightValue = getSortValue(right, field);
        const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
        if (comparison) return clause.direction === 'DESCENDING' ? -comparison : comparison;
      }
      return 0;
    };
    documents.sort(compareDocuments);

    const startAt = structuredQuery.startAt as JsonObject | undefined;
    if (startAt) {
      const values = startAt.values as JsonObject[] | undefined ?? [];
      const cursorValue = String(values[0]?.stringValue ?? '');
      const cursorId = String(values[1]?.referenceValue ?? '').split('/').at(-1) ?? '';
      const cursorDocument = doc(`${collectionId}/${cursorId}`, { [String((orderBy[0]?.field as JsonObject | undefined)?.fieldPath ?? '')]: cursorValue });
      documents = documents.filter((document) => compareDocuments(document, cursorDocument) > 0);
    }
    return documents.slice(0, Number(structuredQuery.limit ?? Number.MAX_SAFE_INTEGER));
  }

  async batchGet(paths: string[]): Promise<Map<string, FirestoreDocument>> {
    const result = new Map<string, FirestoreDocument>();
    for (const path of paths) {
      const document = this.documents.get(path);
      if (document) result.set(document.name, document);
    }
    return result;
  }

  async get(path: string): Promise<FirestoreDocument | null> {
    return this.documents.get(path) ?? null;
  }
}

const env: Bindings = {
  FIREBASE_PROJECT_ID: projectId,
  BANCA_ID: bankId,
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
  CLIENT_SESSION_PEPPER: 'catalog-test-pepper-with-more-than-thirty-two-bytes',
  CORS_ORIGINS: 'https://banca.example.test',
  CLIENT_RATE_LIMITER: { limit: async ({ key }) => { rateLimitCalls.push(key); return { success: true }; } },
};

async function requestCatalog(db: CatalogFirestore, query: string): Promise<{ items: JsonObject[]; page: { limit: number; nextCursor: string | null; hasMore: boolean } }> {
  const request = new Request(`https://banca.example.test/api/public/catalog?${query}`);
  const context: RequestContext = {
    request,
    url: new URL(request.url),
    env,
    db: db as unknown as FirestoreRest,
    corsOrigin: null,
  };
  const response = await handlePublicRoute(context);
  if (!response) throw new Error('Expected the public catalog route to handle this request.');
  const payload = await response.json() as { data: { items: JsonObject[]; page: { limit: number; nextCursor: string | null; hasMore: boolean } } };
  return payload.data;
}

describe('Cloudflare Worker public catalog', () => {
  it('searches and filters beyond the first raw page, then continues without dropping results', async () => {
    rateLimitCalls.length = 0;
    const db = new CatalogFirestore();
    const params = new URLSearchParams({ q: 'HISTORIAS', type: 'MANGA', availability: 'available', sort: 'recent', limit: '1' });

    const firstPage = await requestCatalog(db, params.toString());
    expect(rateLimitCalls).toHaveLength(1);

    expect(firstPage.items.map((item) => item.title)).toEqual(['Histórias além da estação']);
    expect(firstPage.items[0].available).toBe(8);
    expect(firstPage.items[0].status).toBe('AVAILABLE');
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).toBeTruthy();

    params.set('cursor', firstPage.page.nextCursor!);
    const secondPage = await requestCatalog(db, params.toString());

    expect(secondPage.items.map((item) => item.title)).toEqual(['Histórias além da estação']);
    expect(secondPage.items[0].itemReparteId).not.toBe(firstPage.items[0].itemReparteId);
    expect(secondPage.page.hasMore).toBe(false);
    expect(secondPage.page.nextCursor).toBeNull();
  });

  it('searches publisher names on the server across the catalog', async () => {
    const page = await requestCatalog(new CatalogFirestore(), new URLSearchParams({ q: 'editora especial', sort: 'recent', limit: '1' }).toString());

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ itemReparteId: 'stock-040', publisher: 'Editora Especial' });
  });

  it('includes low-stock items in the available filter and reports them as reservable inventory', async () => {
    const page = await requestCatalog(new CatalogFirestore(), new URLSearchParams({ availability: 'available', sort: 'recent', limit: '1' }).toString());

    expect(page.items[0]).toMatchObject({ title: 'Título 060', available: 2, status: 'AVAILABLE' });
  });

  it('rate-limits catalog detail and returns the item envelope with current availability', async () => {
    rateLimitCalls.length = 0;
    const request = new Request('https://banca.example.test/api/public/catalog/stock-060');
    const context: RequestContext = {
      request,
      url: new URL(request.url),
      env,
      db: new CatalogFirestore() as unknown as FirestoreRest,
      corsOrigin: null,
    };

    const response = await handlePublicRoute(context);

    expect(rateLimitCalls).toHaveLength(1);
    expect(response).not.toBeNull();
    const payload = await response!.json() as { data: { item: JsonObject } };
    expect(payload.data.item).toMatchObject({ itemReparteId: 'stock-060', available: 2, status: 'AVAILABLE' });
  });
});
