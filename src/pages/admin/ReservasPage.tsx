import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Search, XCircle } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { adminRepository, type ReservaAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

const states = ['TODAS', 'ATIVA', 'PARCIALMENTE_RETIRADA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA'];

function formatPickupDate(value: string) {
  const timestamp = Date.parse(`${value.slice(0, 10)}T12:00:00`);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    : 'Data não informada';
}

export function ReservasPage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [filter, setFilter] = useState('TODAS');
  const [items, setItems] = useState<ReservaAdmin[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    if (!user) return;
    if (cursor) { setLoadingMore(true); setMoreFailed(false); }
    else setLoading(true);
    try {
      const page = await adminRepository.reservationsPage(user, { ...(filter === 'TODAS' ? {} : { status: filter }), cursor });
      setItems((current) => cursor ? [...current, ...page.reservations] : page.reservations);
      setNextCursor(page.nextCursor);
      setFailed(false);
    } catch {
      if (cursor) setMoreFailed(true);
      else setFailed(true);
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [user, filter]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function cancel(reservation: ReservaAdmin) {
    if (!user || cancellingId) return;
    setCancellingId(reservation.id);
    try {
      await adminRepository.cancelReservation(user, reservation.id);
      toast('Reserva cancelada e unidades liberadas para o catálogo.');
      setNextCursor(null);
      await load();
    } catch { toast('Não foi possível cancelar esta reserva.', 'info'); }
    finally { setCancellingId(null); }
  }

  const visible = items.filter((item) => !search || `${item.clienteNome} ${item.id} ${item.itens.map((product) => product.titulo).join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));

  return <div className="admin-page">
    <AdminHeading kicker="04 · OPERAÇÃO / RESERVAS" title="Acompanhe cada reserva." description="As intenções ajudam a equipe; a retirada só se confirma no balcão." />
    <div className="admin-filter-toolbar">
      <label className="catalog-search"><Search size={17} /><Input aria-label="Buscar reservas" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou título" /></label>
      <div className="admin-filter-row">{states.map((state) => <button type="button" key={state} aria-pressed={filter === state} className={`filter-pill${filter === state ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setFilter(state); }}>{state === 'TODAS' ? 'Todas' : state.toLowerCase().replaceAll('_', ' ')}</button>)}</div>
    </div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : visible.length ? <>
      <div className="admin-reservation-list">{visible.map((reservation) => <article className="admin-reservation-card" key={reservation.id}>
        <div className="admin-reservation-card__top"><div><span className="eyebrow">RESERVA / {reservation.id.slice(0, 8).toUpperCase()}</span><h2>{reservation.clienteNome}</h2><small>Telefone {reservation.clienteTelefoneMascarado}</small></div><Badge tone={reservation.status === 'ATIVA' ? 'lime' : 'muted'}>{reservation.status.replaceAll('_', ' ')}</Badge></div>
        <div className="admin-reservation-card__items">{reservation.itens.map((item) => <div key={item.itemReservaId}><span><strong>{item.titulo}</strong><small>{item.volume ? `Volume ${item.volume} · ` : ''}{item.quantidade} un. · {item.quantidadeRetirada} retiradas</small></span><span>{item.itemReparteId.slice(0, 7)}</span></div>)}</div>
        <div className="admin-reservation-card__footer"><span><CalendarDays size={15} /> {formatPickupDate(reservation.dataRetiradaPretendida)}{reservation.horarioAproximado ? ` · ~${reservation.horarioAproximado}` : ''}</span><span className="intent-label">Intenção: <b>{reservation.intencaoRetirada.replaceAll('_', ' ').toLowerCase()}</b></span></div>
        <div className="admin-reservation-card__actions">
          <a className="text-button" href={`https://wa.me/?text=${encodeURIComponent(`Olá ${reservation.clienteNome}, sobre sua reserva na Banca Ana Maria...`)}`} target="_blank" rel="noreferrer">Abrir WhatsApp <ArrowRight size={15} /></a>
          {['ATIVA', 'PARCIALMENTE_RETIRADA'].includes(reservation.status) && <Button variant="secondary" size="small" disabled={cancellingId !== null} onClick={() => void cancel(reservation)}>{cancellingId === reservation.id ? 'Cancelando…' : <><XCircle size={15} /> Cancelar reserva</>}</Button>}
        </div>
      </article>)}</div>
      {nextCursor && <div className="history-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? 'Carregando…' : moreFailed ? 'Tentar carregar novamente' : 'Carregar mais reservas'}</Button></div>}
    </> : <AdminEmpty title="Nenhuma reserva neste filtro" detail="Quando clientes reservarem um título, os detalhes aparecem aqui." />}
  </div>;
}
