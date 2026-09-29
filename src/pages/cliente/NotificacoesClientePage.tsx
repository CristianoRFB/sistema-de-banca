import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { lerSessaoCliente } from '../../infra/local-storage/cliente-session';
import { notificacaoRepository } from '../../features/notificacoes/notificacao.repository';
import type { NotificacaoCliente } from '../../features/notificacoes/notificacao.types';
import { BuscarPerfil } from '../../features/cliente/components/BuscarPerfil';

export function NotificacoesClientePage() {
  const [session, setSession] = useState(() => lerSessaoCliente());
  const [items, setItems] = useState<NotificacaoCliente[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !!lerSessaoCliente());
  const [loadingMore, setLoadingMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [moreUnavailable, setMoreUnavailable] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (cursor: string | null = null) => {
    if (!session) return;
    if (cursor) { setLoadingMore(true); setMoreUnavailable(false); }
    else setLoading(true);
    try {
      const page = await notificacaoRepository.listMinePage(session.token, cursor);
      setItems((current) => cursor ? [...current, ...page.notifications] : page.notifications);
      setNextCursor(page.nextCursor);
      setUnavailable(false);
    } catch {
      if (cursor) setMoreUnavailable(true);
      else setUnavailable(true);
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [session]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function markRead(item: NotificacaoCliente) {
    if (!session || item.lida || markingId) return;
    setMarkingId(item.id);
    try {
      await notificacaoRepository.markMineRead(session.token, item.id);
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, lida: true } : entry));
    } catch { toast('Não foi possível atualizar este aviso.', 'info'); }
    finally { setMarkingId(null); }
  }

  return (
    <div className="customer-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">05 · CAIXA DE ENTRADA</span><span className="page-count">NOTIFICAÇÕES / CLIENTE</span></div>
      <header className="customer-heading"><div><span className="eyebrow">NOTIFICAÇÕES</span><h1>Recados que<br /><em>importam.</em></h1></div><Bell className="customer-heading__icon" size={34} /></header>
      {!session ? <section className="identity-panel"><div className="identity-panel__intro"><span className="identity-icon"><Bell size={20} /></span><div><h2>Abra sua caixa de entrada</h2><p>Entre com seu perfil para ver avisos de reservas.</p></div></div><BuscarPerfil onAuthenticated={(next) => { setLoading(true); setSession(next); }} /></section>
        : loading ? <div className="loading-block"><LoaderCircle className="spin" size={18} /> Carregando avisos…</div>
          : unavailable ? <div className="empty-state"><h2>Caixa de entrada indisponível.</h2><p>Tente novamente quando sua conexão estiver estável.</p><Button variant="secondary" onClick={() => window.location.reload()}>Tentar de novo</Button></div>
            : items.length ? <><div className="notification-list">{items.map((item) => <article className={`notification-card${item.lida ? '' : ' is-unread'}`} key={item.id}><span className="notification-mark"><Bell size={17} /></span><div><span className="eyebrow">{item.tipo.replaceAll('_', ' ')}</span><h2>{item.titulo}</h2><p>{item.mensagem}</p><time dateTime={item.criadaEm}>{new Date(item.criadaEm).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}</time>{!item.lida && <button className="text-button notification-mark-read" type="button" disabled={markingId !== null} onClick={() => void markRead(item)}>{markingId === item.id ? 'Salvando…' : 'Marcar como lida'}</button>}</div>{item.lida && <Check className="notification-read" size={17} aria-label="Lida" />}</article>)}</div>{nextCursor && <div className="history-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? 'Carregando…' : moreUnavailable ? 'Tentar carregar novamente' : 'Carregar mais avisos'}</Button></div>}</>
              : <div className="empty-state"><Bell size={24} /><span className="eyebrow">SEM NOTIFICAÇÕES</span><h2>Nenhum recado por enquanto.</h2><p>Se surgir uma novidade sobre sua reserva, ela aparece aqui.</p><Link className="button button--dark" to="/cliente/reservas">Ver minhas reservas</Link></div>}
    </div>
  );
}
