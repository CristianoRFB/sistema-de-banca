import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Store } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { firebaseReady } from '../../app/config';
import { normalizeTenantSlug, tenantPanelPath, tenantPath } from '../../app/tenant';
import { loginAdmin } from '../../infra/firebase/auth';
import { useAdminAuth } from '../../app/providers';
import { getTenantBootstrap, type TenantBootstrap } from '../../features/banca/tenant-bootstrap';

export function LoginAdminPage() {
  const { user, configured } = useAdminAuth();
  const navigate = useNavigate();
  const { tenantSlug } = useParams();
  const slug = normalizeTenantSlug(tenantSlug);
  const panelPath = tenantPanelPath(slug);
  const [tenantCheck, setTenantCheck] = useState<{ slug: string; tenant: TenantBootstrap | null } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (user) navigate(panelPath, { replace: true }); }, [user, navigate, panelPath]);
  useEffect(() => {
    let active = true;
    getTenantBootstrap()
      .then((value) => {
        if (active) setTenantCheck({ slug, tenant: value.active && value.slug === slug ? value : null });
      })
      .catch(() => {
        if (active) setTenantCheck({ slug, tenant: null });
      });
    return () => { active = false; };
  }, [slug]);
  const verifiedTenant = tenantCheck?.slug === slug ? tenantCheck.tenant : null;
  if (user) return <Navigate to={panelPath} replace />;
  if (!tenantCheck || tenantCheck.slug !== slug) {
    return <main className="page-wrap loading-block" role="status">Confirmando a banca antes do login…</main>;
  }
  if (!verifiedTenant) {
    return <main className="page-wrap empty-state" role="alert">
      <h1>Não foi possível verificar esta banca.</h1>
      <p>Confira o endereço ou a conexão antes de informar suas credenciais.</p>
      <Link className="button button--secondary" to={tenantPath(slug)}>Voltar ao site</Link>
    </main>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setLoading(true);
    try { await loginAdmin(email, password); navigate(panelPath, { replace: true }); }
    catch { setError('Não foi possível entrar. Confira os dados ou fale com quem administra o Firebase.'); }
    finally { setLoading(false); }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <Link className="back-link" to={tenantPath(slug)}><ArrowLeft size={17} /> Voltar ao site</Link>
        <div className="admin-login-brand"><span className="brand-mark">B<span>.</span></span><span><b>{verifiedTenant?.name || 'Banca'}</b><small>ACESSO DA EQUIPE</small></span></div>
        <span className="eyebrow">OPERAÇÃO / LOGIN SEGURO</span>
        <h1>A banca,<br /><em>por dentro.</em></h1>
        <p className="muted-copy">Entre com sua conta administrativa para gerenciar listas, reservas e recolhimentos.</p>
        {!firebaseReady && <div className="config-callout" role="status"><KeyRound size={17} /><span>Este ambiente ainda não recebeu a configuração Web do Firebase. Preencha as variáveis `VITE_FIREBASE_*` a partir do cadastro oficial.</span></div>}
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label className="field-label">E-mail<Input autoComplete="username" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field-label">Senha<Input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button block disabled={!configured || loading}>{loading ? 'Entrando…' : 'Entrar no painel'} <ArrowRight size={17} /></Button>
        </form>
        <p className="privacy-note"><Store size={14} /> {verifiedTenant?.name || 'Banca'} · {verifiedTenant?.address || 'Localização não informada'}</p>
      </section>
      <div className="admin-login-art"><span>{(verifiedTenant?.name || 'Banca').split(' ').slice(0, 2).map((part) => part.toLocaleUpperCase('pt-BR')).join('\n')}</span><b>ADMIN<br />TENANT</b><i>✳</i></div>
    </main>
  );
}
