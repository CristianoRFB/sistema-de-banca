import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type ReparteAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

const filters = [
  { value: 'ABERTOS', label: 'Em andamento' },
  { value: 'ENCERRADO', label: 'Encerrados' },
  { value: 'RASCUNHO', label: 'Rascunhos' },
  { value: 'ARQUIVADO', label: 'Arquivados' },
  { value: 'TODOS', label: 'Todos' },
];

export function RecolhimentosPage() {
  const { user } = useAdminAuth();
  const [filter, setFilter] = useState('ABERTOS');
  const [items, setItems] = useState<ReparteAdmin[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  const load = useCallback(async (next: string | null = null) => {
    if (!user) return;
    if (next) { setLoadingMore(true); setMoreFailed(false); }
    else setLoading(true);
    try {
      const page = await adminRepository.repartesPage(user, filter, next);
      setItems((current) => next ? [...current, ...page.repartes] : page.repartes);
      setCursor(page.page?.nextCursor ?? null);
      setFailed(false);
    } catch {
      if (next) setMoreFailed(true);
      else setFailed(true);
    } finally {
      if (next) setLoadingMore(false);
      else setLoading(false);
    }
  }, [user, filter]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <div className="admin-page">
    <AdminHeading kicker="06 · ESTOQUE / RECOLHIMENTO" title="Feche cada lote com clareza." description="Conte o que está fisicamente na banca antes de confirmar a devolução." />
    <div className="admin-filter-row">{filters.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} className={`filter-pill${filter === item.value ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setFilter(item.value); }}>{item.label}</button>)}</div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : items.length ? <>
      <div className="admin-list-grid">{items.map((item) => {
        const canReconcile = ['ATIVO', 'AGUARDANDO_RECOLHIMENTO'].includes(item.status);
        const card = <><div className="admin-list-card__top"><Badge tone={item.status === 'AGUARDANDO_RECOLHIMENTO' ? 'orange' : item.status === 'ENCERRADO' || item.status === 'ARQUIVADO' ? 'muted' : 'lime'}>{item.status.replaceAll('_', ' ')}</Badge><span>{item.itemCount ?? '—'} itens</span></div><h2>{item.title}</h2><p><CalendarDays size={14} /> {item.plannedCollectionAt ? new Date(item.plannedCollectionAt).toLocaleDateString('pt-BR') : 'Data não cadastrada'}</p><div className="admin-list-card__footer"><span>{canReconcile ? 'Registrar conferência física' : 'Lote preservado no histórico'}</span>{canReconcile && <ArrowRight size={17} />}</div></>;
        return canReconcile
          ? <Link className="admin-list-card" to={`/admin/recolhimentos/${item.id}`} key={item.id}>{card}</Link>
          : <article className="admin-list-card" key={item.id}>{card}</article>;
      })}</div>
      {cursor && <div className="history-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(cursor)}>{loadingMore ? 'Carregando…' : moreFailed ? 'Tentar carregar novamente' : 'Carregar mais lotes'}</Button></div>}
    </> : <AdminEmpty title="Nenhum lote neste filtro" detail="Lotes e datas de recolhimento aparecem aqui quando listas são importadas." />}
  </div>;
}
