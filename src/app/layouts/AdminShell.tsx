import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, BookOpen, Boxes, Clock3, History, LayoutDashboard, LogOut, Settings2, Store, UserRound } from 'lucide-react';
import { useAdminAuth } from '../providers';
import { logoutAdmin } from '../../infra/firebase/auth';

const adminLinks = [
  { to: '/admin', label: 'Visão geral', mobileLabel: 'Início', icon: LayoutDashboard, end: true },
  { to: '/admin/listas', label: 'Listas', mobileLabel: 'Listas', icon: BookOpen },
  { to: '/admin/reservas', label: 'Reservas', mobileLabel: 'Reservas', icon: Bell },
  { to: '/admin/retiradas', label: 'Retiradas hoje', mobileLabel: 'Retirada', icon: Clock3 },
  { to: '/admin/recolhimentos', label: 'Recolhimentos', mobileLabel: 'Lotes', icon: Boxes },
  { to: '/admin/historico', label: 'Histórico', mobileLabel: 'Histórico', icon: History },
  { to: '/admin/perfil', label: 'Perfil da banca', mobileLabel: 'Perfil', icon: Store },
  { to: '/admin/configuracoes', label: 'Configurações', mobileLabel: 'Ajustes', icon: Settings2 },
];

export function AdminShell() {
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  async function logout() { await logoutAdmin(); navigate('/admin/login'); }
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <NavLink className="admin-brand" to="/admin"><span className="brand-mark">B<span>.</span></span><span><b>BANCA</b><small>PAINEL ANA MARIA</small></span></NavLink>
        <div className="admin-sidebar__label">OPERAÇÃO</div>
        <nav aria-label="Navegação administrativa">{adminLinks.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `admin-nav-link${isActive ? ' is-active' : ''}`}><Icon size={17} /><span>{label}</span></NavLink>)}</nav>
        <div className="admin-sidebar__spacer" />
        <div className="admin-user"><span className="admin-user__avatar"><UserRound size={17} /></span><div><b>{user?.displayName || user?.email || 'Equipe da banca'}</b><small>Conta administrativa</small></div></div>
        <button className="admin-logout" type="button" onClick={() => void logout()}><LogOut size={17} /> Sair</button>
        <NavLink className="admin-back" to="/"><ArrowLeft size={15} /> Voltar ao site</NavLink>
      </aside>
      <div className="admin-main"><header className="admin-topbar"><span className="eyebrow">BANCA ANA MARIA · OPERAÇÃO</span><span className="admin-topbar__status"><span className="status-dot" /> PAINEL ADMINISTRATIVO</span></header><main className="admin-content"><Outlet /></main></div>
      <nav className="admin-mobile-nav" aria-label="Navegação administrativa no celular">{adminLinks.map(({ to, label, mobileLabel, icon: Icon, end }) => <NavLink key={to} to={to} end={end} aria-label={label} title={label} className={({ isActive }) => isActive ? 'is-active' : ''}><Icon size={18} /><span>{mobileLabel}</span></NavLink>)}</nav>
    </div>
  );
}
