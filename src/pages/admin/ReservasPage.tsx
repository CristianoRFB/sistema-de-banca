import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Search } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { adminRepository, type ReservaAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

const states = ['TODAS', 'ATIVA', 'PARCIALMENTE_RETIRADA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA'];

export function ReservasPage() {
  const { user } = useAdminAuth();
  const [filter, setFilter] = useState('TODAS');
  const [items, setItems] = useState<ReservaAdmin[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setItems(await adminRepository.reservations(user, filter === 'TODAS' ? {} : { status: filter })); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user, filter]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const visible = items.filter((item) => !search || `${item.clienteNome} ${item.id} ${item.itens.map((product) => product.titulo).join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));

  return <div className="admin-page">
    <AdminHeading kicker="04 · OPERAÇÃO / RESERVAS" title="Acompanhe cada reserva." description="As intenções ajudam a equipe; a retirada só se confirma no balcão." />
    <div className="admin-filter-toolbar"><label className="catalog-search"><Search size={17} /><Input aria-label="Buscar reservas" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome ou título" /></label><div className="admin-filter-row">{states.map((state) => <button type="button" key={state} className={`filter-pill${filter === state ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setFilter(state); }}>{state === 'TODAS' ? 'Todas' : state.toLowerCase().replaceAll('_', ' ')}</button>)}</div></div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => void load()} /> : visible.length ? <div className="admin-reservation-list">{visible.map((reservation) => <article className="admin-reservation-card" key={reservation.id}><div className="admin-reservation-card__top"><div><span className="eyebrow">RESERVA / {reservation.id.slice(0, 8).toUpperCase()}</span><h2>{reservation.clienteNome}</h2><small>Telefone {reservation.clienteTelefoneMascarado}</small></div><Badge tone={reservation.status === 'ATIVA' ? 'lime' : 'muted'}>{reservation.status.replaceAll('_', ' ')}</Badge></div><div className="admin-reservation-card__items">{reservation.itens.map((item) => <div key={item.itemReservaId}><span><strong>{item.titulo}</strong><small>{item.volume ? `Volume ${item.volume} · ` : ''}{item.quantidade} un. · {item.quantidadeRetirada} retiradas</small></span><span>{item.itemReparteId.slice(0, 7)}</span></div>)}</div><div className="admin-reservation-card__footer"><span><CalendarDays size={15} /> {new Date(`${reservation.dataRetiradaPretendida.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}{reservation.horarioAproximado ? ` · ~${reservation.horarioAproximado}` : ''}</span><span className="intent-label">Intenção: <b>{reservation.intencaoRetirada.replaceAll('_', ' ').toLowerCase()}</b></span></div><a className="text-button" href={`https://wa.me/?text=${encodeURIComponent(`Olá ${reservation.clienteNome}, sobre sua reserva na Banca Ana Maria...`)}`} target="_blank" rel="noreferrer">Abrir WhatsApp <ArrowRight size={15} /></a></article>)}</div>
      : <AdminEmpty title="Nenhuma reserva neste filtro" detail="Quando clientes reservarem um título, os detalhes aparecem aqui." />}
  </div>;
}
