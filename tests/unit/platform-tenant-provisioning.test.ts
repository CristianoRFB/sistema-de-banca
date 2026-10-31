import { describe, expect, it, vi } from 'vitest';
import { handlePlatformRoute } from '../../cloudflare/worker/src/routes/platform';
import type { FirestoreDocument, JsonObject, RequestContext } from '../../cloudflare/worker/src/types';
import type { FirestoreRest } from '../../cloudflare/worker/src/firebase/firestore-rest';

vi.mock('../../cloudflare/worker/src/security', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../cloudflare/worker/src/security')>();
  return {
    ...original,
    requirePlatformOwner: vi.fn(async () => ({
      uid: 'platform-owner-uid', role: 'PLATFORM_OWNER', claims: {},
    })),
  };
});

function doc(path: string, data: JsonObject): FirestoreDocument {
  return { name: 'projects/test/databases/(default)/documents/' + path,
    id: path.split('/').at(-1) ?? '', data };
}

class ProvisioningDb {
  records = new Map<string, JsonObject>();
  failCommit = false;
  async transact<T>(run: (tx: {
    get: (path: string) => Promise<FirestoreDocument | null>;
    query: (collection: string, structured: JsonObject) => Promise<FirestoreDocument[]>;
    set: (path: string, data: JsonObject, options?: { mustNotExist?: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    const writes: Array<{ path: string; data: JsonObject; mustNotExist: boolean }> = [];
    const result = await run({
      get: async (path) => {
        const data = this.records.get(path);
        return data ? doc(path, data) : null;
      },
      query: async (collection, structured) => {
        if (collection !== 'bancas') throw new Error('Unexpected query collection');
        const where = structured.where as { fieldFilter?: { value?: { stringValue: string } } } | undefined;
        const slug = where?.fieldFilter?.value?.stringValue;
        return [...this.records.entries()]
          .filter(([path, value]) => /^bancas\/[^/]+$/.test(path) && value.slug === slug)
          .map(([path, data]) => doc(path, data));
      },
      set: (path, data, options) => {
        writes.push({ path, data, mustNotExist: options?.mustNotExist === true });
      },
    });
    if (this.failCommit) throw new Error('Simulated Firestore commit failure');
    // The simulated commit is all-or-nothing. No partial bank, membership or slug.
    if (writes.some((write) => write.mustNotExist && this.records.has(write.path))) {
      throw new Error('Simulated Firestore ALREADY_EXISTS');
    }
    for (const write of writes) this.records.set(write.path, write.data);
    return result;
  }
}

function ctx(db: ProvisioningDb, body: JsonObject): RequestContext {
  const request = new Request('https://example.test/api/platform/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    request, url: new URL(request.url), db: db as unknown as FirestoreRest,
    env: { BANCA_ID: 'platform' } as RequestContext['env'], corsOrigin: null,
    tenant: { id: 'platform', slug: 'platform', name: 'Platform', active: true, legacyFallback: false },
  };
}
const create = (db: ProvisioningDb, override: JsonObject = {}) => handlePlatformRoute(ctx(db, {
  slug: 'new-tenant', name: 'Banca Nova', initialOwnerUid: 'firebase-uid-owner', ...override,
}));

describe('atomic tenant owner onboarding', () => {
  it('creates tenant, slug guard, active owner and two audit events in one commit', async () => {
    const db = new ProvisioningDb();
    const response = await create(db);
    expect(response?.status).toBe(201);
    const body = await response!.json() as { data: { tenant: { id: string; slug: string; initialOwnerUid: string } } };
    const id = body.data.tenant.id;
    expect(body.data.tenant).toMatchObject({ slug: 'new-tenant', initialOwnerUid: 'firebase-uid-owner' });
    expect(db.records.get('bancas/' + id)).toMatchObject({ slug: 'new-tenant', ativo: true });
    expect(db.records.get('tenantSlugs/new-tenant')).toMatchObject({ slug: 'new-tenant', tenantId: id });
    expect(db.records.get('bancas/' + id + '/usuarios/firebase-uid-owner')).toMatchObject({
      papel: 'TENANT_OWNER', ativo: true,
    });
    const audit = [...db.records.entries()].filter(([path]) => path.startsWith('auditLogs/'))
      .map(([, record]) => record);
    expect(audit.map((event) => event.action)).toEqual(['TENANT_CREATED', 'MEMBERSHIP_CREATED']);
    expect(audit.every((event) => event.tenantId === id && event.actorUid === 'platform-owner-uid')).toBe(true);
  });

  it('refuses to create an active bank without an explicit valid owner UID', async () => {
    const db = new ProvisioningDb();
    for (const owner of [undefined, null, '', 'ab', '../other-owner', 123]) {
      await expect(create(db, { initialOwnerUid: owner })).rejects.toMatchObject({
        code: 'invalid_initial_owner_uid', status: 400,
      });
    }
    expect(db.records.size).toBe(0);
  });

  it('rejects both pre-registry slugs and already reserved slugs', async () => {
    const legacy = new ProvisioningDb();
    legacy.records.set('bancas/legacy-bank', { slug: 'new-tenant', ativo: true });
    await expect(create(legacy)).rejects.toMatchObject({ code: 'tenant_conflict', status: 409 });
    expect(legacy.records.size).toBe(1);

    const registered = new ProvisioningDb();
    registered.records.set('tenantSlugs/new-tenant', { slug: 'new-tenant', tenantId: 'someone-else' });
    await expect(create(registered)).rejects.toMatchObject({ code: 'tenant_conflict', status: 409 });
    expect(registered.records.size).toBe(1);
  });

  it('does not create an orphaned tenant when a multi-document commit fails', async () => {
    const db = new ProvisioningDb();
    db.failCommit = true;
    await expect(create(db)).rejects.toThrow('Simulated Firestore commit failure');
    expect(db.records.size).toBe(0);
  });

  it('rejects a second creation with the same slug without changing the first owner', async () => {
    const db = new ProvisioningDb();
    await create(db);
    await expect(create(db, { initialOwnerUid: 'another-owner-uid' })).rejects.toMatchObject({
      code: 'tenant_conflict', status: 409,
    });
    const owners = [...db.records.entries()].filter(([path]) => path.includes('/usuarios/'));
    expect(owners).toHaveLength(1);
    expect(owners[0][0]).toContain('firebase-uid-owner');
  });
});
