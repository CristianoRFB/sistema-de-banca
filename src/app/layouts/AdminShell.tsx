import { useEffect, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bell, BookOpen, Boxes, Clock3, History, LayoutDashboard, LogOut, Settings2, Store, UserRound } from 'lucide-react';
import { useAdminAuth } from '../providers';
import { normalizeTenantSlug, tenantPanelPath, tenantPath } from '../tenant';
import { logoutAdmin } from '../../infra/firebase/auth';
import { getTenantBootstrap, type TenantBootstrap } from '../../features/banca/tenant-bootstrap';

const adminLinks = [
  { suffix: '', label: 'Visão geral', mobileLabel: 'Início', icon: LayoutDashboard, end: true },
  { suffix: 'listas', label: 'Listas', mobileLabel: 'Listas', icon: BookOpen },
  { suffix: 'reservas', label: 'Reservas', mobileLabel: 'Reservas', icon: Bell },
  { suffix: 'retiradas', label: 'Retiradas hoje', mobileLabel: 'Retirada', icon: Clock3 },
  { suffix: 'recolhimentos', label: 'Recolhimentos', mobileLabel: 'Lotes', icon: Boxes },
  { suffix: 'notificacoes', label: 'Avisos da equipe', mobileLabel: 'Avisos', icon: Bell },
  { suffix: 'historico', label: 'Histórico', mobileLabel: 'Histórico', icon: History },
  { suffix: 'perfil', label: 'Perfil da banca', mobileLabel: 'Perfil', icon: Store },
  { suffix: 'configuracoes', label: 'Configurações', mobileLabel: 'Ajustes', icon: Settings2 },
];

export function AdminShell({ supportExpiresAt = null }: { supportExpiresAt?: string | null }) {
  const { user } = useAdminAuth();
  const [tenant, setTenant] = useState<TenantBootstrap | null>(null);
  const { tenantSlug } = useParams();
  const slug = normalizeTenantSlug(tenantSlug);
  const navigate = useNavigate();
  const root = tenantPanelPath(slug);

  useEffect(() => {
    let active = true;
    getTenantBootstrap().then((value) => { if (active) setTenant(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [slug]);

  const tenantName = tenant?.name || slug;
  const tenantStyle = {
    '--lime': tenant?.branding.primaryColor ?? undefined,
    '--orange': tenant?.branding.accentColor ?? undefined,
    '--paper': tenant?.branding.backgroundColor ?? undefined,
    '--ink': tenant?.branding.textColor ?? undefined,
  } as CSSProperties;

  async function logout() {
    await logoutAdmin();
    navigate(tenantPanelPath(slug, 'login'));
  }

  return (
    <div className="admin-shell" data-tenant={slug} style={tenantStyle}>
      <aside className="admin-sidebar">
        <NavLink className="admin-brand" to={root}><span className="brand-mark">B<span>.</span></span><span><b>BANCA</b><small>{tenantName}</small></span></NavLink>
        <div className="admin-sidebar__label">OPERAÇÃO</div>
        <nav aria-label="Navegação administrativa">
          {adminLinks.map(({ suffix, label, icon: Icon, end }) => {
            const to = tenantPanelPath(slug, suffix);
            return <NavLink key={to} to={to} end={end} className={({ isActive }) => 'admin-nav-link' + (isActive ? ' is-active' : '')}><Icon size={17} /><span>{label}</span></NavLink>;
          })}
        </nav>
        <div className="admin-sidebar__spacer" />
        <div className="admin-user"><span className="admin-user__avatar"><UserRound size={17} /></span><div><b>{user?.displayName || user?.email || 'Equipe da banca'}</b><small>Conta administrativa</small></div></div>
        <button className="admin-logout" type="button" onClick={() => void logout()}><LogOut size={17} /> Sair</button>
        <NavLink className="admin-back" to={tenantPath(slug)}><ArrowLeft size={15} /> Voltar ao site</NavLink>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span className="eyebrow">{tenantName.toLocaleUpperCase('pt-BR')} · OPERAÇÃO</span>
          <span className="admin-topbar__status"><span className="status-dot" /> PAINEL ADMINISTRATIVO</span>
          <div className="admin-topbar__mobile-actions">
            <Link className="admin-topbar__action" to={tenantPath(slug)} aria-label="Voltar ao site público"><ArrowLeft size={15} /> Site</Link>
            <button className="admin-topbar__action" type="button" onClick={() => void logout()} aria-label="Sair do painel"><LogOut size={15} /> Sair</button>
          </div>
        </header>
        {supportExpiresAt && (
          <div role="status" className="form-error">
            SUPORTE TEMPORÁRIO · Somente leitura · Banca: {tenantName} · Expira em {new Date(supportExpiresAt).toLocaleString('pt-BR')}.
            Ações de alteração não são autorizadas nesta sessão de suporte.
          </div>
        )}
        <main className="admin-content"><Outlet /></main>
      </div>
      <nav className="admin-mobile-nav" aria-label="Navegação administrativa no celular">
        {adminLinks.map(({ suffix, label, mobileLabel, icon: Icon, end }) => {
          const to = tenantPanelPath(slug, suffix);
          return <NavLink key={to} to={to} end={end} aria-label={label} title={label} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={18} /><span>{mobileLabel}</span></NavLink>;
        })}
      </nav>
    </div>
  );
}
