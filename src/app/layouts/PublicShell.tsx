import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { BookOpen, House, MapPin, UserRound } from 'lucide-react';
import { TenantPublicProvider } from '../tenant-public-context';
import { normalizeTenantSlug, tenantPanelPath, tenantPath } from '../tenant';
import { isUsingCachedPublicData, subscribeCachedPublicData } from '../../infra/browser/api-client';
import { getTenantBootstrap, type TenantBootstrap } from '../../features/banca/tenant-bootstrap';

type TenantStyle = CSSProperties & Record<'--lime' | '--orange' | '--paper' | '--ink', string | undefined>;

export function PublicShell() {
  const { tenantSlug } = useParams();
  const slug = normalizeTenantSlug(tenantSlug);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [tenant, setTenant] = useState<TenantBootstrap | null>(null);
  const [tenantState, setTenantState] = useState<'loading' | 'ready' | 'failure'>('loading');
  const [attempt, setAttempt] = useState(0);
  const usingCachedData = useSyncExternalStore(subscribeCachedPublicData, isUsingCachedPublicData, () => false);

  const nav = [
    { to: tenantPath(slug), label: 'Início', icon: House, end: true },
    { to: tenantPath(slug, 'catalogo'), label: 'Catálogo', icon: BookOpen },
    { to: tenantPath(slug, 'cliente/reservas'), label: 'Reservas', icon: BookOpen },
    { to: tenantPath(slug, 'cliente/perfil'), label: 'Perfil', icon: UserRound },
  ];

  useEffect(() => {
    let active = true;
    setTenantState('loading');
    setTenant(null);
    document.title = 'SaaS Banca';
    getTenantBootstrap()
      .then((value) => {
        if (!active) return;
        if (!value.active || value.slug !== slug) {
          setTenantState('failure');
          return;
        }
        setTenant(value);
        document.title = value.name;
        setTenantState('ready');
      })
      .catch(() => {
        if (active) setTenantState('failure');
      });
    return () => { active = false; };
  }, [slug, attempt]);

  useEffect(() => {
    const updateOnlineStatus = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const name = tenant?.name ?? 'Banca';
  const phoneDigits = (tenant?.phone ?? '').replace(/\D/g, '');
  const tagline = tenant?.branding.tagline || (tenant?.address ? 'Encontre a banca em ' + tenant.address + '.' : 'Sua banca de leitura.');
  const style: TenantStyle = {
    '--lime': tenant?.branding.primaryColor ?? undefined,
    '--orange': tenant?.branding.accentColor ?? undefined,
    '--paper': tenant?.branding.backgroundColor ?? undefined,
    '--ink': tenant?.branding.textColor ?? undefined,
  };

  // Do not mount child pages or expose another bank's fallback details until
  // this slug is verified by the backend. Also block unknown/disabled tenants.
  if (tenantState === 'loading' || !tenant && tenantState !== 'failure') {
    return <div className="page-wrap loading-block" role="status">Confirmando a banca…</div>;
  }
  if (tenantState === 'failure' || !tenant) {
    return <div className="page-wrap empty-state" role="alert">
      <h1>Não foi possível abrir esta banca.</h1>
      <p>Confira o endereço ou a conexão. Nenhuma informação de outra banca será exibida.</p>
      <button className="button button--secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
    </div>;
  }

  return (
    <TenantPublicProvider tenant={tenant}>
    <div className="site-shell" data-tenant={slug} style={style}>
      {(!online || usingCachedData) && (
        <div className="offline-notice" role="status" aria-live="polite">
          {!online
            ? 'Sem conexão. O perfil e o catálogo podem estar desatualizados; reservas e outras ações exigem internet.'
            : 'Conteúdo público salvo no aparelho pode estar desatualizado. Reservas serão confirmadas pelo serviço antes de concluir.'}
        </div>
      )}
      <header className="site-header">
        <Link className="brand-lockup" to={tenantPath(slug)} aria-label={name + ', início'}>
          {tenant?.branding.logoUrl
            ? <img className="tenant-logo" src={tenant.branding.logoUrl} alt="" />
            : <span className="brand-mark">B<span>.</span></span>}
          <span className="brand-name">{name}</span>
        </Link>
        <nav className="desktop-nav" aria-label="Navegação principal">
          <NavLink to={tenantPath(slug, 'catalogo')}>Catálogo</NavLink>
          <NavLink to={tenantPath(slug, 'localizacao')}><MapPin size={16} /> Como chegar</NavLink>
          {phoneDigits && <a href={'https://wa.me/' + phoneDigits} target="_blank" rel="noreferrer">WhatsApp ↗</a>}
        </nav>
        <Link className="header-cta" to={tenantPath(slug, 'cliente/reservas')}>Minhas reservas <span>↗</span></Link>
      </header>
      <main className="site-main"><Outlet /></main>
      <footer className="site-footer">
        <Link className="footer-brand" to={tenantPath(slug)}>
          {tenant?.branding.logoUrl
            ? <img className="tenant-logo tenant-logo--small" src={tenant.branding.logoUrl} alt="" />
            : <span className="brand-mark brand-mark--small">B<span>.</span></span>}
          <span>{name}</span>
        </Link>
        <span>{tagline}</span>
        <Link to={tenantPanelPath(slug, 'login')}>Área da banca <span aria-hidden="true">↗</span></Link>
      </footer>
      <nav className="bottom-nav" aria-label="Navegação inferior">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => 'bottom-nav__item' + (isActive ? ' is-active' : '')}>
            <Icon size={19} strokeWidth={2.3} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
    </TenantPublicProvider>
  );
}
