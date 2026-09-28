import { useEffect, useState } from 'react';
import { Bell, Check, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { lerSessaoCliente } from '../../infra/local-storage/cliente-session';
import { notificacaoRepository } from '../../features/notificacoes/notificacao.repository';
import type { NotificacaoCliente } from '../../features/notificacoes/notificacao.types';
import { BuscarPerfil } from '../../features/cliente/components/BuscarPerfil';

export function NotificacoesClientePage() {
  const [session, setSession] = useState(() => lerSessaoCliente());
  const [items, setItems] = useState<NotificacaoCliente[] | null>(null);
  const [loading, setLoading] = useState(() => !!lerSessaoCliente());
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!session) return;
    let active = true;
    notificacaoRepository.listMine(session.token).then((result) => {
      if (active) { setItems(result); setUnavailable(false); }
    }).catch(() => { if (active) setUnavailable(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session]);

  return (
    <div className="customer-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">05 · CAIXA DE ENTRADA</span><span className="page-count">NOTIFICAÇÕES / CLIENTE</span></div>
      <header className="customer-heading"><div><span className="eyebrow">NOTIFICAÇÕES</span><h1>Recados que<br /><em>importam.</em></h1></div><Bell className="customer-heading__icon" size={34} /></header>
      {!session ? <section className="identity-panel"><div className="identity-panel__intro"><span className="identity-icon"><Bell size={20} /></span><div><h2>Abra sua caixa de entrada</h2><p>Entre com seu perfil para ver avisos de reservas.</p></div></div><BuscarPerfil onAuthenticated={(next) => { setLoading(true); setSession(next); }} /></section>
        : loading ? <div className="loading-block"><LoaderCircle className="spin" size={18} /> Carregando avisos…</div>
          : unavailable ? <div className="empty-state"><h2>Caixa de entrada indisponível.</h2><p>Tente novamente quando sua conexão estiver estável.</p><Button variant="secondary" onClick={() => window.location.reload()}>Tentar de novo</Button></div>
            : items?.length ? <div className="notification-list">{items.map((item) => <article className={`notification-card${item.lida ? '' : ' is-unread'}`} key={item.id}><span className="notification-mark"><Bell size={17} /></span><div><span className="eyebrow">{item.tipo.replaceAll('_', ' ')}</span><h2>{item.titulo}</h2><p>{item.mensagem}</p><time dateTime={item.criadaEm}>{new Date(item.criadaEm).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>{item.lida && <Check className="notification-read" size={17} aria-label="Lida" />}</article>)}</div>
              : <div className="empty-state"><Bell size={24} /><span className="eyebrow">SEM NOTIFICAÇÕES</span><h2>Nenhum recado por enquanto.</h2><p>Se surgir uma novidade sobre sua reserva, ela aparece aqui.</p><Link className="button button--dark" to="/cliente/reservas">Ver minhas reservas</Link></div>}
    </div>
  );
}
