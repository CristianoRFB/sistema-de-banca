import type { PropsWithChildren, ReactNode } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export function AdminHeading({ kicker, title, description, action, children }: PropsWithChildren<{ kicker: string; title: string; description?: string; action?: ReactNode }>) {
  return <header className="admin-page-heading"><div><span className="eyebrow">{kicker}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}{children}</header>;
}

export function AdminLoading({ label = 'Carregando dados da banca…' }: { label?: string }) {
  return <div className="admin-state"><LoaderCircle className="spin" size={20} /> {label}</div>;
}

export function AdminLoadError({ onRetry }: { onRetry?: () => void }) {
  return <div className="admin-load-error"><strong>Não foi possível carregar este painel.</strong><span>Confira a conexão e o acesso administrativo.</span>{onRetry && <button type="button" onClick={onRetry}>Tentar novamente <ArrowRight size={15} /></button>}</div>;
}

export function AdminEmpty({ title, detail, to, link = 'Abrir' }: { title: string; detail: string; to?: string; link?: string }) {
  return <div className="admin-empty"><span>—</span><div><strong>{title}</strong><p>{detail}</p></div>{to && <Link to={to}>{link} <ArrowRight size={15} /></Link>}</div>;
}
