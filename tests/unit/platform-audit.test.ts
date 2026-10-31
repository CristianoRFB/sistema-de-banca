import { describe, expect, it, vi } from 'vitest';
import { handlePlatformRoute } from '../../cloudflare/worker/src/routes/platform';
import type { FirestoreDocument, JsonObject, RequestContext } from '../../cloudflare/worker/src/types';
import type { FirestoreRest } from '../../cloudflare/worker/src/firebase/firestore-rest';

vi.mock('../../cloudflare/worker/src/security', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../cloudflare/worker/src/security')>();
  return {
    ...original,
    requirePlatformOwner: vi.fn(async () => ({ uid: 'platform-owner', role: 'PLATFORM_OWNER', claims: {} })),
  };
});

const projectId = 'audit-test-project';
const documentPrefix = `projects/${projectId}/databases/(default)/documents/auditLogs/`;

function fixture() {
  const all = Array.from({ length: 77 }, (_, index): FirestoreDocument => {
    const createdAt = new Date(Date.parse('2026-10-30T12:00:00.000Z') - index * 60_000).toISOString();
    return {
      id: `audit-${String(index).padStart(3, '0')}`,
      name: documentPrefix + `audit-${String(index).padStart(3, '0')}`,
      data: {
        scope: index === 9 ? 'TENANT' : 'PLATFORM',
        tenantId: index % 2 ? 'tenant-b' : 'tenant-a',
        actorUid: 'platform-owner',
        actorRole: 'PLATFORM_OWNER',
        action: 'MEMBERSHIP_UPDATED',
        entityId: 'uid-example',
        createdAt,
        details: { privateNote: 'MUST-NOT-BE-EXPOSED' },
      },
    };
  });
  const queries: Array<{ collection: string; structured: JsonObject }> = [];
  const db = {
    async query(collection: string, structured: JsonObject) {
      queries.push({ collection, structured });
      if (collection !== 'auditLogs') throw new Error('Cross-collection query');
      const where = structured.where as {
        fieldFilter?: { field: { fieldPath: string }; value: { stringValue: string } };
        compositeFilter?: { filters: Array<{ fieldFilter: { field: { fieldPath: string }; value: { stringValue: string } } }> };
      };
      const filters = where.fieldFilter ? [where.fieldFilter]
        : (where.compositeFilter?.filters ?? []).map((item) => item.fieldFilter);
      let filtered = all.filter((row) =>
        filters.every((filter) => row.data[filter.field.fieldPath] === filter.value.stringValue));
      if (structured.startAt) {
        const startAt = structured.startAt as { values: Array<{ stringValue?: string; referenceValue?: string }>; before: boolean };
        const after = filtered.findIndex((row) =>
          row.data.createdAt === startAt.values[0].stringValue && row.name === startAt.values[1].referenceValue);
        if (after < 0 || startAt.before !== false) throw new Error('Invalid exclusive cursor');
        filtered = filtered.slice(after + 1);
      }
      return filtered.slice(0, Number(structured.limit));
    },
  };
  const context = (suffix = ''): RequestContext => {
    const request = new Request('https://example.test/api/platform/audit' + suffix);
    return {
      request, url: new URL(request.url),
      db: db as unknown as FirestoreRest,
      env: { FIREBASE_PROJECT_ID: projectId } as RequestContext['env'],
      corsOrigin: null,
      tenant: { id: 'platform', slug: 'platform', name: 'Platform', active: true, legacyFallback: false },
    };
  };
  return { context, queries };
}

async function result(ctx: RequestContext) {
  const response = await handlePlatformRoute(ctx);
  expect(response?.status).toBe(200);
  return (await response!.json() as { data: {
    events: Array<{ id: string; tenantId: string; createdAt: string; details?: unknown }>;
    page: { limit: number; hasMore: boolean; nextCursor: string | null };
  } }).data;
}

describe('Platform Owner audit trail', () => {
  it('paginates recent platform events with stable exclusive cursors and no private details', async () => {
    const { context, queries } = fixture();
    const one = await result(context('?limit=50'));
    const two = await result(context('?limit=50&cursor=' + encodeURIComponent(one.page.nextCursor!)));
    expect(one.events).toHaveLength(50);
    expect(two.events).toHaveLength(26);
    expect(one.page.hasMore).toBe(true);
    expect(two.page.hasMore).toBe(false);
    expect(new Set([...one.events, ...two.events].map((event) => event.id)).size).toBe(76);
    expect(one.events[0].id).toBe('audit-000');
    expect(two.events.at(-1)?.id).toBe('audit-076');
    expect(one.events.every((event) => !('details' in event))).toBe(true);
    expect(queries.every((query) => query.collection === 'auditLogs')).toBe(true);
    expect(queries[0].structured.orderBy).toEqual([
      { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
      { field: { fieldPath: '__name__' }, direction: 'DESCENDING' },
    ]);
  });

  it('applies tenant filters inside the Firestore query, not in the client', async () => {
    const { context, queries } = fixture();
    const page = await result(context('?tenantId=tenant-b&limit=20'));
    expect(page.events).toHaveLength(20);
    expect(page.events.every((event) => event.tenantId === 'tenant-b')).toBe(true);
    expect(JSON.stringify(queries[0].structured.where)).toContain('tenant-b');
    expect(JSON.stringify(queries[0].structured.where)).toContain('PLATFORM');
    const next = await result(context('?tenantId=tenant-b&limit=20&cursor=' + encodeURIComponent(page.page.nextCursor!)));
    expect(next.events.every((event) => event.tenantId === 'tenant-b')).toBe(true);
    expect(next.page.nextCursor).toBeNull();
  });

  it('rejects invalid limits, tenant identifiers and cursor values without querying', async () => {
    const { context, queries } = fixture();
    for (const suffix of ['?limit=51', '?limit=0', '?tenantId=../other',
      '?cursor=broken', '?cursor=2026-10-30T12:00:00.000Z%7C..']) {
      await expect(handlePlatformRoute(context(suffix))).rejects.toMatchObject({ status: 400 });
    }
    expect(queries).toHaveLength(0);
  });
});
