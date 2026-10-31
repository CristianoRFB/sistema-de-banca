import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { apiRequest } from '../../infra/browser/api-client';
import { Button } from '../../components/ui/Button';

interface AuditEvent {
  id: string;
  action: string;
  actorUid: string;
  tenantId: string | null;
  entityId: string | null;
  createdAt: string;
}

interface AuditResponse {
  events: AuditEvent[];
  page: { limit: number; hasMore: boolean; nextCursor: string | null };
}

const actions: Record<string, string> = {
  TENANT_CREATED: 'Banca criada',
  TENANT_ACTIVATED: 'Banca ativada',
  TENANT_DEACTIVATED: 'Banca desativada',
  MEMBERSHIP_CREATED: 'Acesso criado',
  MEMBERSHIP_UPDATED: 'Acesso atualizado',
  PLATFORM_SUPPORT_GRANTED: 'Suporte temporário concedido',
  PLATFORM_SUPPORT_REVOKED: 'Suporte temporário revogado',
};

export function PlatformAuditSection({ tenants }: {
  tenants: Array<{ id: string; name: string }>;
}) {
  const { user } = useAdminAuth();
  const [tenantId, setTenantId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  // Ignore responses from a previous filter, refresh or authenticated user.
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!user) return;
    let active = true;
    const query = new URLSearchParams({ limit: '20' });
    if (tenantId) query.set('tenantId', tenantId);
    user.getIdToken()
      .then((token) => apiRequest<AuditResponse>(`/platform/audit?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      }))
      .then((result) => {
        if (!active || generation.current !== current) return;
        setEvents(result.events);
        setNextCursor(result.page.nextCursor);
        setError('');
      })
      .catch((cause) => {
        if (!active || generation.current !== current) return;
        setError(cause instanceof Error ? cause.message : 'Não foi possível consultar a auditoria.');
      })
      .finally(() => {
        if (active && generation.current === current) setLoading(false);
      });
    return () => { active = false; };
  }, [user, tenantId, refresh]);

  function changeFilter(value: string) {
    generation.current += 1;
    setTenantId(value);
    setEvents([]);
    setNextCursor(null);
    setError('');
    setLoading(true);
  }

  function reload() {
    generation.current += 1;
    setEvents([]);
    setNextCursor(null);
    setError('');
    setLoading(true);
    setRefresh((value) => value + 1);
  }

  async function loadMore() {
    if (!user || !nextCursor || loadingMore || loading) return;
    const current = generation.current;
    const query = new URLSearchParams({ limit: '20', cursor: nextCursor });
    if (tenantId) query.set('tenantId', tenantId);
    setLoadingMore(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const result = await apiRequest<AuditResponse>(`/platform/audit?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (generation.current !== current) return;
      setEvents((previous) => [...previous, ...result.events]);
      setNextCursor(result.page.nextCursor);
    } catch (cause) {
      if (generation.current === current) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar mais registros.');
      }
    } finally {
      if (generation.current === current) setLoadingMore(false);
    }
  }

  return (
    <section className="admin-card" aria-label="Auditoria da plataforma">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GOVERNANÇA · SOMENTE LEITURA</span>
          <h2>Auditoria da plataforma</h2>
        </div>
        <ShieldCheck size={20} />
      </div>
      <p className="muted-copy">Eventos de criação de bancas, alteração de acessos e suporte. Registros disponíveis somente ao Platform Owner.</p>
      <div className="button-row">
        <label className="field-label">Filtrar por banca
          <select aria-label="Filtrar auditoria por banca" value={tenantId} onChange={(event) => changeFilter(event.target.value)}>
            <option value="">Todas as bancas</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </label>
        <Button type="button" variant="secondary" disabled={loading || loadingMore} onClick={reload}>Atualizar auditoria</Button>
      </div>
      {loading ? <div role="status" className="loading-block">Carregando auditoria…</div> : (
        <>
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="data-list">
            {events.map((event) => (
              <article className="data-list__item" key={event.id}>
                <div>
                  <b>{actions[event.action] ?? event.action}</b>
                  <small>{event.tenantId
                    ? tenants.find((tenant) => tenant.id === event.tenantId)?.name ?? event.tenantId
                    : 'Plataforma'} · Responsável: {event.actorUid}</small>
                  {event.entityId && <small>Registro: {event.entityId}</small>}
                </div>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString('pt-BR')}
                </time>
              </article>
            ))}
            {!events.length && !error && <p className="muted-copy">Nenhum evento encontrado neste filtro.</p>}
          </div>
          {nextCursor && (
            <div className="button-row">
              <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? 'Carregando…' : 'Carregar mais eventos'}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
