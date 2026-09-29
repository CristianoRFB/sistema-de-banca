import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAdminAuth } from './providers';
import { PublicShell } from './layouts/PublicShell';
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

function AdminGate() {
  const { user, loading } = useAdminAuth();
  if (loading) return <div className="loading-block">Validando acesso…</div>;
  return user ? <AdminShell /> : <Navigate to="/admin/login" replace />;
}

export function AppRoutes() {
  return <Suspense fallback={<div className="loading-block" role="status">Abrindo a página…</div>}>
    <Routes>
      <Route element={<PublicShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalogo" element={<CatalogoPage />} />
        <Route path="/produto/:itemReparteId" element={<ProdutoPage />} />
        <Route path="/localizacao" element={<LocalizacaoPage />} />
        <Route path="/cliente/reservas" element={<MinhasReservasPage />} />
        <Route path="/cliente/reservas/:reservaId" element={<ReservaDetalhesPage />} />
        <Route path="/cliente/perfil" element={<PerfilClientePage />} />
        <Route path="/cliente/notificacoes" element={<NotificacoesClientePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="/admin/login" element={<LoginAdminPage />} />
      <Route path="/admin" element={<AdminGate />}>
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
    </Routes>
  </Suspense>;
}
