import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Bell, CalendarDays, Check, Clock3, LoaderCircle, PackageCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { BuscarPerfil } from '../../features/cliente/components/BuscarPerfil';
import type { ReservaCliente } from '../../features/cliente/cliente.types';
import { clienteRepository } from '../../features/cliente/cliente.repository';
import { lerSessaoCliente, removerSessaoCliente } from '../../infra/local-storage/cliente-session';
import { reservaRepository } from '../../features/reservas/reserva.repository';
import { useToast } from '../../components/ui/Toast';

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'long' });
}

function statusText(status: ReservaCliente['status']) {
  return ({ ATIVA: 'Aguardando retirada', PARCIALMENTE_RETIRADA: 'Retirada parcial', CONCLUIDA: 'Concluída', CANCELADA: 'Cancelada', EXPIRADA: 'Expirada' })[status];
}

export function MinhasReservasPage() {
  const [session, setSession] = useState(() => lerSessaoCliente());
  const [items, setItems] = useState<ReservaCliente[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !!lerSessaoCliente());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(async (cursor: string | null = null) => {
    if (!session) return;
    if (cursor) { setLoadingMore(true); setMoreFailed(false); }
    else setLoading(true);
    try {
      const page = await reservaRepository.listMinePage(session.token, cursor);
      setItems((current) => cursor ? [...current, ...page.reservations] : page.reservations);
      setNextCursor(page.nextCursor);
      setError(false);
    } catch {
      if (cursor) setMoreFailed(true);
      else setError(true);
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [session]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function updateIntent(id: string, intent: 'VOU_BUSCAR' | 'ESTOU_INDO') {
    if (!session) return;
    try { await reservaRepository.setIntent(session.token, id, intent); toast(intent === 'ESTOU_INDO' ? 'A banca foi avisada que você está a caminho.' : 'A banca foi avisada que você pretende buscar.'); await load(); }
    catch { toast('Não foi possível atualizar a reserva agora.', 'info'); }
  }

  async function cancel(id: string) {
    if (!session) return;
    try { await reservaRepository.cancel(session.token, id); toast('Reserva cancelada. A disponibilidade foi atualizada.'); await load(); }
    catch { toast('Não foi possível cancelar agora. Tente novamente.', 'info'); }
  }

  async function logout() {
    if (!session || loggingOut) return;
    setLoggingOut(true);
    try {
      await clienteRepository.logout(session.token);
      removerSessaoCliente(); setSession(null); setItems([]);
    } catch {
      toast('Não foi possível encerrar a sessão agora. Verifique a conexão e tente novamente.', 'info');
    } finally { setLoggingOut(false); }
  }

  return (
    <div className="customer-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">03 · SEU CANTO DA BANCA</span><span className="page-count">RESERVAS / CLIENTE</span></div>
      <header className="customer-heading"><div><span className="eyebrow">RESERVAS</span><h1>Suas histórias<br /><em>estão guardadas.</em></h1></div>{session && <p>Olá, {session.nome.split(' ')[0]}.</p>}</header>
      {!session ? <section className="identity-panel"><div className="identity-panel__intro"><span className="identity-icon"><PackageCheck size={21} /></span><div><h2>Encontre suas reservas</h2><p>Entre com nome e telefone para ver sua lista.</p></div></div><BuscarPerfil onAuthenticated={(next) => { setLoading(true); setSession(next); navigate('/cliente/reservas'); }} /></section>
        : loading ? <div className="loading-block"><LoaderCircle className="spin" size={19} /> Buscando suas reservas…</div>
          : error ? <div className="empty-state"><h2>Não conseguimos abrir suas reservas.</h2><p>Confira a conexão e tente novamente.</p><Button variant="secondary" onClick={() => void load()}>Tentar de novo</Button></div>
            : items.length ? <><div className="reservation-list">{items.map((reservation) => <article className="reservation-card" key={reservation.id}>
              <div className="reservation-card__top"><span className="eyebrow">RESERVA #{reservation.id.slice(0, 6).toUpperCase()}</span><Badge tone={reservation.status === 'ATIVA' ? 'lime' : 'muted'}>{statusText(reservation.status)}</Badge></div>
              <div className="reservation-card__body"><div className="reservation-items">{reservation.itens.map((item) => <div key={item.itemReservaId}><span className="reservation-item__mark">読</span><span><strong>{item.titulo}</strong><small>{item.volume ? `Vol. ${item.volume} · ` : ''}{item.quantidade} {item.quantidade === 1 ? 'unidade' : 'unidades'}</small></span></div>)}</div>
                <div className="reservation-detail-row"><span><CalendarDays size={16} /> Retirada pretendida</span><b>{formatDate(reservation.dataRetiradaPretendida)}</b></div>
                <div className="reservation-detail-row"><span><Clock3 size={16} /> Prazo</span><b>{formatExpiry(reservation.expiraEm)}</b></div>
              </div>
              {reservation.status === 'ATIVA' || reservation.status === 'PARCIALMENTE_RETIRADA' ? <div className="reservation-card__actions"><Button size="small" onClick={() => void updateIntent(reservation.id, 'VOU_BUSCAR')}><Check size={15} /> Vou buscar</Button><Button size="small" variant="secondary" onClick={() => void updateIntent(reservation.id, 'ESTOU_INDO')}>Estou indo <ArrowRight size={15} /></Button><button className="text-button" type="button" onClick={() => void cancel(reservation.id)}>Desistir</button><Link className="text-button" to={`/cliente/reservas/${reservation.id}`}>Detalhes</Link></div> : <div className="reservation-card__footer"><span>Histórico preservado</span><Link to={`/cliente/reservas/${reservation.id}`}>Ver detalhes <ArrowRight size={15} /></Link></div>}
            </article>)}</div>{nextCursor && <div className="history-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? 'Carregando…' : moreFailed ? 'Tentar carregar novamente' : 'Carregar mais reservas'}</Button></div>}</>
            : <div className="empty-state"><Bell size={24} /><span className="eyebrow">SEM RESERVAS ATIVAS</span><h2>Uma boa história<br />está te esperando.</h2><p>Explore o catálogo e reserve o próximo volume direto pelo celular.</p><Link className="button button--dark" to="/catalogo">Explorar catálogo <ArrowRight size={17} /></Link></div>}
      {session && <button type="button" className="text-button signout-link" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Encerrando…' : 'Sair deste dispositivo'}</button>}
    </div>
  );
}

function formatExpiry(value: string) {
  const expiry = new Date(value);
  const today = new Date();
  const delta = Math.max(0, Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000));
  if (delta === 0) return `Expira hoje às ${expiry.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (delta === 1) return 'Expira amanhã';
  return `${delta} dias restantes`;
}
