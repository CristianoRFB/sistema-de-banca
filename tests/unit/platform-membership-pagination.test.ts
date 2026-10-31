import { describe, expect, it, vi } from 'vitest';
import { handlePlatformRoute } from '../../cloudflare/worker/src/routes/platform';
import { HttpError, type FirestoreDocument, type JsonObject, type RequestContext } from '../../cloudflare/worker/src/types';
import type { FirestoreRest } from '../../cloudflare/worker/src/firebase/firestore-rest';

vi.mock('../../cloudflare/worker/src/security', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../cloudflare/worker/src/security')>();
  return {
    ...original,
    requirePlatformOwner: vi.fn(async () => ({ uid: 'platform-owner', role: 'PLATFORM_OWNER', claims: {} })),
  };
});

const projectId = 'platform-membership-pagination-test';
const tenant = 'tenant-a';
const prefix = `projects/${projectId}/databases/(default)/documents/`;

function makeDocument(path: string, data: JsonObject): FirestoreDocument {
  return { id: path.split('/').at(-1) ?? '', name: prefix + path, data };
}

function setup() {
  const members = Array.from({ length: 255 }, (_, i) => makeDocument(
    `bancas/${tenant}/usuarios/uid-${String(i).padStart(4, '0')}`,
    { papel: i % 2 ? 'STAFF' : 'ADMIN', ativo: i % 3 !== 0 },
  ));
  const seenQueries: Array<{ collection: string; query: JsonObject }> = [];
  const db = {
    async get(path: string) {
      return path === `bancas/${tenant}`
        ? makeDocument(path, { ativo: true, slug: 'banca-a' })
        : null;
    },
    async query(collection: string, structuredQuery: JsonObject) {
      seenQueries.push({ collection, query: structuredQuery });
      if (collection !== `bancas/${tenant}/usuarios`) throw new Error('Cross-tenant query');
      const order = structuredQuery.orderBy as Array<{ field: { fieldPath: string } }>;
      if (order?.[0]?.field?.fieldPath !== '__name__') throw new Error('Unordered membership page');
      const bound = structuredQuery.startAt as { values?: Array<{ referenceValue?: string }>; before?: boolean } | undefined;
      const cursor = bound?.values?.[0]?.referenceValue;
      if (cursor && !cursor.startsWith(prefix + `bancas/${tenant}/usuarios/`)) throw new Error('Foreign cursor');
      if (cursor && bound?.before !== false) throw new Error('Non-exclusive cursor');
      const offset = cursor ? members.findIndex((member) => member.name === cursor) + 1 : 0;
      if (cursor && !offset) throw new Error('Unknown cursor');
      return members.slice(offset, offset + Number(structuredQuery.limit));
    },
  };
  const context = (suffix = ''): RequestContext => {
    const request = new Request(`https://example.test/api/platform/tenants/${tenant}/memberships${suffix}`);
    return {
      request, url: new URL(request.url),
      env: { FIREBASE_PROJECT_ID: projectId } as RequestContext['env'],
      db: db as unknown as FirestoreRest, corsOrigin: null,
      tenant: { id: 'platform', slug: 'platform', name: 'Platform', active: true, legacyFallback: false },
    };
  };
  return { context, seenQueries };
}

type Page = { data: { memberships: Array<{ uid: string; role: string; active: boolean }>; page: {
  limit: number; hasMore: boolean; nextCursor: string | null;
} } };

async function fetchPage(ctx: RequestContext): Promise<Page['data']> {
  const response = await handlePlatformRoute(ctx);
  expect(response?.status).toBe(200);
  const payload = await response!.json() as Page;
  return payload.data;
}

describe('platform tenant membership pagination', () => {
  it('iterates beyond 200 records without dropping inactive memberships', async () => {
    const { context, seenQueries } = setup();
    const all: Page['data']['memberships'] = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const suffix: string = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await fetchPage(context(suffix));
      all.push(...page.memberships);
      cursor = page.page.nextCursor;
      expect(page.page.hasMore).toBe(pageIndex < 2);
    }
    expect(all).toHaveLength(255);
    expect(new Set(all.map((member) => member.uid)).size).toBe(255);
    expect(all.some((member) => member.active === false)).toBe(true);
    expect(all.at(-1)?.uid).toBe('uid-0254');
    expect(cursor).toBeNull();
    expect(seenQueries.every((item) => item.collection === 'bancas/tenant-a/usuarios')).toBe(true);
    expect(seenQueries.map((item) => Number(item.query.limit))).toEqual([101, 101, 101]);
  });

  it('enforces bounded pages and rejects foreign or malformed cursors', async () => {
    const { context, seenQueries } = setup();
    const first = await fetchPage(context());
    expect(first.memberships).toHaveLength(50);
    expect(first.page).toEqual({ limit: 50, hasMore: true, nextCursor: 'uid-0049' });
    const second = await fetchPage(context('?cursor=uid-0049'));
    expect(second.memberships.at(0)?.uid).toBe('uid-0050');
    expect(seenQueries.at(-1)?.query.startAt).toEqual({
      values: [{ referenceValue: prefix + 'bancas/tenant-a/usuarios/uid-0049' }], before: false,
    });
    for (const url of ['?cursor=../tenant-b', '?cursor=x', '?cursor=', '?limit=101', '?limit=0']) {
      await expect(handlePlatformRoute(context(url))).rejects.toMatchObject({
        code: url.startsWith('?limit') ? 'invalid_limit' : 'invalid_cursor', status: 400,
      } satisfies Partial<HttpError>);
    }
  });
});
