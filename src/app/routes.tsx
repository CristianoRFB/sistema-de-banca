import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useAdminAuth } from './providers';
import { DEFAULT_TENANT_SLUG, normalizeTenantSlug, tenantPanelPath, tenantPath } from './tenant';
import { PublicShell } from './layouts/PublicShell';
import { apiRequest } from '../infra/browser/api-client';
import { AdminShell } from './layouts/AdminShell';

const HomePage = lazy(() => import('../pages/public/HomePage').then(({ HomePage: page }) => ({ default: page })));
const CatalogoPage = lazy(() => import('../pages/public/CatalogoPage').then(({ CatalogoPage: page }) => ({ default: page })));
const ProdutoPage = lazy(() => import('../pages/public/ProdutoPage').then(({ ProdutoPage: page }) => ({ default: page })));
const LocalizacaoPage = lazy(() => import('../pages/public/LocalizacaoPage').then(({ LocalizacaoPage: page }) => ({ default: page })));
const MinhasReservasPage = lazy(() => import('../pages/cliente/MinhasReservasPage').then(({ MinhasReservasPage: page }) => ({ default: page })));
const PerfilClientePage = lazy(() => import('../pages/cliente/PerfilClientePage').then(({ PerfilClientePage: page }) => ({ default: page })));
const NotificacoesClientePage = lazy(() => import('../pages/cliente/NotificacoesClientePage').then(({ NotificacoesClientePage: page }) => ({ default: page })));
const ReservaDetalhesPage = lazy(() => import('../pages/cliente/ReservaDetalhesPage').then(({ ReservaDetalhesPage: page }) => ({ default: page })));
const LoginAdminPage = lazy(() => import('../pages/admin/LoginAdminPage').then(({ LoginAdminPage: page }) => ({ default: page })));
const DashboardPage = lazy(() => import('../pages/admin/DashboardPage').then(({ DashboardPage: page }) => ({ default: page })));
const ListasPage = lazy(() => import('../pages/admin/ListasPage').then(({ ListasPage: page }) => ({ default: page })));
const NovaListaPage = lazy(() => import('../pages/admin/NovaListaPage').then(({ NovaListaPage: page }) => ({ default: page })));
const RevisarListaPage = lazy(() => import('../pages/admin/RevisarListaPage').then(({ RevisarListaPage: page }) => ({ default: page })));
const ReservasPage = lazy(() => import('../pages/admin/ReservasPage').then(({ ReservasPage: page }) => ({ default: page })));
const RetiradasHojePage = lazy(() => import('../pages/admin/RetiradasHojePage').then(({ RetiradasHojePage: page }) => ({ default: page })));
const RecolhimentosPage = lazy(() => import('../pages/admin/RecolhimentosPage').then(({ RecolhimentosPage: page }) => ({ default: page })));
const ConferirRecolhimentoPage = lazy(() => import('../pages/admin/ConferirRecolhimentoPage').then(({ ConferirRecolhimentoPage: page }) => ({ default: page })));
const HistoricoPage = lazy(() => import('../pages/admin/HistoricoPage').then(({ HistoricoPage: page }) => ({ default: page })));
const NotificacoesAdminPage = lazy(() => import('../pages/admin/NotificacoesAdminPage').then(({ NotificacoesAdminPage: page }) => ({ default: page })));
const PerfilBancaPage = lazy(() => import('../pages/admin/PerfilBancaPage').then(({ PerfilBancaPage: page }) => ({ default: page })));
const ConfiguracoesPage = lazy(() => import('../pages/admin/ConfiguracoesPage').then(({ ConfiguracoesPage: page }) => ({ default: page })));
const PlatformLoginPage = lazy(() => import('../pages/platform/PlatformLoginPage').then(({ PlatformLoginPage: page }) => ({ default: page })));
const PlatformAdminPage = lazy(() => import('../pages/platform/PlatformAdminPage').then(({ PlatformAdminPage: page }) => ({ default: page })));

function TenantAdminGate() {
  const { user, loading } = useAdminAuth();
  const { tenantSlug } = useParams();
  const slug = normalizeTenantSlug(tenantSlug);
  const [verified, setVerified] = useState<{ slug: string; allowed: boolean } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    user.getIdToken()
      .then((token) => apiRequest('/admin/session', { headers: { Authorization: `Bearer ${token}` } }))
      .then(() => { if (active) setVerified({ slug, allowed: true }); })
      .catch(() => { if (active) setVerified({ slug, allowed: false }); });
    return () => { active = false; };
  }, [user, slug]);

  if (loading) return <div className="loading-block">Validando acesso…</div>;
  if (!user) return <Navigate to={tenantPanelPath(slug, 'login')} replace />;
  if (!verified || verified.slug !== slug) return <div className="loading-block">Confirmando acesso à banca…</div>;
  if (!verified.allowed) {
    return <div className="page-wrap empty-state" role="alert">
      <span className="eyebrow">ACESSO NÃO AUTORIZADO</span>
      <h1>Esta conta não pertence a esta banca.</h1>
      <p>Trocar o slug ou abrir um link de outra banca não concede acesso.</p>
      <Link className="button button--secondary" to={tenantPath(slug)}>Voltar ao site</Link>
    </div>;
  }
  return <AdminShell />;
}

function PlatformGate() {
  const { user, loading } = useAdminAuth();
  if (loading) return <div className="loading-block">Validando acesso…</div>;
  return user ? <Outlet /> : <Navigate to="/admin/login" replace />;
}

function LegacyRedirect() {
  const location = useLocation();
  return <Navigate to={tenantPath(DEFAULT_TENANT_SLUG, location.pathname)} replace />;
}

function LegacyProductRedirect() {
  const { itemReparteId } = useParams();
  return <Navigate to={tenantPath(DEFAULT_TENANT_SLUG, `produto/${encodeURIComponent(itemReparteId ?? '')}`)} replace />;
}

export function AppRoutes() {
  return <Suspense fallback={<div className="loading-block" role="status">Abrindo a página…</div>}>
    <Routes>
      <Route path="/" element={<Navigate to={tenantPath(DEFAULT_TENANT_SLUG)} replace />} />

      <Route path="/catalogo" element={<LegacyRedirect />} />
      <Route path="/localizacao" element={<LegacyRedirect />} />
      <Route path="/cliente/*" element={<LegacyRedirect />} />
      <Route path="/produto/:itemReparteId" element={<LegacyProductRedirect />} />

      <Route path="/admin/login" element={<PlatformLoginPage />} />
      <Route path="/admin" element={<PlatformGate />}>
        <Route index element={<PlatformAdminPage />} />
      </Route>

      <Route path="/:tenantSlug" element={<PublicShell />}>
        <Route index element={<HomePage />} />
        <Route path="catalogo" element={<CatalogoPage />} />
        <Route path="produto/:itemReparteId" element={<ProdutoPage />} />
        <Route path="localizacao" element={<LocalizacaoPage />} />
        <Route path="cliente/reservas" element={<MinhasReservasPage />} />
        <Route path="cliente/reservas/:reservaId" element={<ReservaDetalhesPage />} />
        <Route path="cliente/perfil" element={<PerfilClientePage />} />
        <Route path="cliente/notificacoes" element={<NotificacoesClientePage />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Route>

      <Route path="/:tenantSlug/painel/login" element={<LoginAdminPage />} />
      <Route path="/:tenantSlug/painel" element={<TenantAdminGate />}>
        <Route index element={<DashboardPage />} />
        <Route path="listas" element={<ListasPage />} />
        <Route path="listas/nova" element={<NovaListaPage />} />
        <Route path="listas/:listaId" element={<RevisarListaPage />} />
        <Route path="reservas" element={<ReservasPage />} />
        <Route path="retiradas" element={<RetiradasHojePage />} />
        <Route path="recolhimentos" element={<RecolhimentosPage />} />
        <Route path="recolhimentos/:reparteId" element={<ConferirRecolhimentoPage />} />
        <Route path="historico" element={<HistoricoPage />} />
        <Route path="notificacoes" element={<NotificacoesAdminPage />} />
        <Route path="perfil" element={<PerfilBancaPage />} />
        <Route path="configuracoes" element={<ConfiguracoesPage />} />
      </Route>

      <Route path="*" element={<Navigate to={tenantPath(DEFAULT_TENANT_SLUG)} replace />} />
    </Routes>
  </Suspense>;
}
