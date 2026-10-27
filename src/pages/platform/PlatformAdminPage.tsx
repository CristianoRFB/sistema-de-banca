import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, LogOut, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../app/providers';
import { tenantPanelPath, tenantPath } from '../../app/tenant';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { apiRequest, jsonBody } from '../../infra/browser/api-client';
import { logoutAdmin } from '../../infra/firebase/auth';

interface PlatformTenant {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function PlatformAdminPage() {
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const result = await apiRequest<{ tenants: PlatformTenant[] }>('/platform/tenants', {
        headers: authHeaders(token),
      });
      setTenants(result.tenants);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os tenants.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setLoading(false);
      return () => { active = false; };
    }
    user.getIdToken()
      .then((token) => apiRequest<{ tenants: PlatformTenant[] }>('/platform/tenants', { headers: authHeaders(token) }))
      .then((result) => { if (active) setTenants(result.tenants); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os tenants.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setWorking(true);
    setError('');
    try {
      const token = await user.getIdToken();
      await apiRequest('/platform/tenants', {
        ...jsonBody({ name, slug }),
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      });
      setName('');
      setSlug('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o tenant.');
    } finally {
      setWorking(false);
    }
  }

  async function toggleTenant(tenant: PlatformTenant) {
    if (!user) return;
    setWorking(true);
    setError('');
    try {
      const token = await user.getIdToken();
      await apiRequest(`/platform/tenants/${encodeURIComponent(tenant.id)}/status`, {
        method: 'PATCH',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !tenant.active }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o tenant.');
    } finally {
      setWorking(false);
    }
  }

  async function logout() {
    await logoutAdmin();
    navigate('/admin/login');
  }

  return (
    <main className="admin-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">77 SAAS · PLATFORM OWNER</span>
          <h1>Tenants da Banca</h1>
          <p className="muted-copy">Administração global. O contexto da banca permanece isolado em cada painel.</p>
        </div>
        <div className="button-row">
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading || working}>
            <RefreshCw size={16} /> Atualizar
          </Button>
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            <LogOut size={16} /> Sair
          </Button>
        </div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <section className="admin-card">
        <div className="section-heading">
          <div><span className="eyebrow">NOVO TENANT</span><h2>Criar banca</h2></div>
          <ShieldCheck size={20} />
        </div>
        <form className="form-stack" onSubmit={(event) => void createTenant(event)}>
          <label className="field-label">Nome<Input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label className="field-label">Slug<Input value={slug} onChange={(event) => setSlug(event.target.value.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9-]/g, '-'))} required /></label>
          <Button disabled={working || !name.trim() || !slug.trim()}><Plus size={16} /> Criar tenant</Button>
        </form>
      </section>

      <section className="admin-card">
        <div className="section-heading">
          <div><span className="eyebrow">TENANTS</span><h2>Bancas cadastradas</h2></div>
          <span>{tenants.length}</span>
        </div>
        {loading ? <div className="loading-block" role="status">Carregando tenants…</div> : (
          <div className="data-list">
            {tenants.map((tenant) => (
              <article className="data-list__item" key={tenant.id}>
                <div>
                  <b>{tenant.name}</b>
                  <small>{tenant.slug} · {tenant.active ? 'ATIVA' : 'DESATIVADA'}</small>
                </div>
                <div className="button-row">
                  <Link className="button button--secondary" to={tenantPath(tenant.slug)}><ExternalLink size={15} /> Site</Link>
                  <Link className="button button--secondary" to={tenantPanelPath(tenant.slug)}><ExternalLink size={15} /> Painel</Link>
                  <Button type="button" variant="secondary" disabled={working} onClick={() => void toggleTenant(tenant)}>
                    {tenant.active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </article>
            ))}
            {!tenants.length && <p className="muted-copy">Nenhum tenant cadastrado.</p>}
          </div>
        )}
      </section>
    </main>
  );
}
