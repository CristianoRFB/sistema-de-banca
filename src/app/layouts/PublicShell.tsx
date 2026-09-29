import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { BookOpen, House, MapPin, UserRound } from 'lucide-react';
import { BANCA } from '../config';
import { isUsingCachedPublicData, subscribeCachedPublicData } from '../../infra/browser/api-client';

const nav = [
  { to: '/', label: 'Início', icon: House, end: true },
  { to: '/catalogo', label: 'Catálogo', icon: BookOpen },
  { to: '/cliente/reservas', label: 'Reservas', icon: BookOpen },
  { to: '/cliente/perfil', label: 'Perfil', icon: UserRound },
];

export function PublicShell() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const usingCachedData = useSyncExternalStore(subscribeCachedPublicData, isUsingCachedPublicData, () => false);

  useEffect(() => {
    const updateOnlineStatus = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  return (
    <div className="site-shell">
      {(!online || usingCachedData) && (
        <div className="offline-notice" role="status" aria-live="polite">
          {!online
            ? 'Sem conexão. O perfil e o catálogo podem estar desatualizados; reservas e outras ações exigem internet.'
            : 'Conteúdo público salvo no aparelho pode estar desatualizado. Reservas serão confirmadas pelo serviço antes de concluir.'}
        </div>
      )}
      <header className="site-header">
        <Link className="brand-lockup" to="/" aria-label="Banca Ana Maria, início">
          <span className="brand-mark">B<span>.</span></span>
          <span className="brand-name">BANCA <b>ANA MARIA</b></span>
        </Link>
        <nav className="desktop-nav" aria-label="Navegação principal">
          <NavLink to="/catalogo">Catálogo</NavLink>
          <NavLink to="/localizacao"><MapPin size={16} /> Como chegar</NavLink>
          <a href={`https://wa.me/${BANCA.phoneDigits}`} target="_blank" rel="noreferrer">WhatsApp ↗</a>
        </nav>
        <Link className="header-cta" to="/cliente/reservas">Minhas reservas <span>↗</span></Link>
      </header>
      <main className="site-main"><Outlet /></main>
      <footer className="site-footer">
        <Link className="footer-brand" to="/"><span className="brand-mark brand-mark--small">B<span>.</span></span><span>Banca Ana Maria</span></Link>
        <span>Feita para leitores de Santa Fé do Sul.</span>
        <Link to="/admin/login">Área da banca <span aria-hidden="true">↗</span></Link>
      </footer>
      <nav className="bottom-nav" aria-label="Navegação inferior">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}>
            <Icon size={19} strokeWidth={2.3} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
