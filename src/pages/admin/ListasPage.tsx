import { useCallback, useEffect, useState } from 'react';
import { Archive, ArrowRight, FilePlus2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type ListaAdmin } from '../../features/admin/admin.repository';
import { useToast } from '../../components/ui/Toast';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

const filters = ['TODAS', 'RASCUNHO', 'PUBLICADA', 'ENCERRADA', 'ARQUIVADA'] as const;

export function ListasPage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [status, setStatus] = useState<(typeof filters)[number]>('TODAS');
  const [lists, setLists] = useState<ListaAdmin[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (cursor: string | null = null) => {
    if (!user) return;
    if (cursor) { setLoadingMore(true); setMoreFailed(false); }
    else setLoading(true);
    try {
      const page = await adminRepository.listsPage(user, status === 'TODAS' ? undefined : status, cursor);
      setLists((current) => cursor ? [...current, ...page.lists] : page.lists);
      setNextCursor(page.page?.nextCursor ?? null);
      setFailed(false);
    } catch {
      if (cursor) setMoreFailed(true);
      else setFailed(true);
    } finally {
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }, [user, status]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function archive(list: ListaAdmin) {
    if (!user || archivingId) return;
    setArchivingId(list.id);
    try {
      await adminRepository.archiveList(user, list.id);
      toast('Lista arquivada e mantida no histórico.');
      setLoading(true);
      await load();
    } catch { toast('Não foi possível arquivar esta lista.', 'info'); }
    finally { setArchivingId(null); }
  }

  return <div className="admin-page">
    <AdminHeading kicker="02 · CATÁLOGO / LISTAS" title="Listas da banca." description="Importe, revise, publique e acompanhe cada lote." action={<Link className="button button--primary" to="/admin/listas/nova"><FilePlus2 size={16} /> Criar lista</Link>} />
    <div className="admin-filter-row">{filters.map((item) => <button key={item} type="button" aria-pressed={status === item} className={`filter-pill${status === item ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setStatus(item); }}>{item === 'TODAS' ? 'Todas' : item.toLowerCase()}</button>)}</div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : lists.length ? <><div className="admin-list-grid">{lists.map((list) => <article className="admin-list-card" key={list.id}><Link className="admin-list-card__link" to={`/admin/listas/${list.id}`}><div className="admin-list-card__top"><Badge tone={list.status === 'PUBLICADA' ? 'lime' : list.status === 'RASCUNHO' ? 'orange' : 'muted'}>{list.status}</Badge><span>{list.totalItems} itens</span></div><h2>{list.title}</h2><p>Criada em {new Date(list.createdAt).toLocaleDateString('pt-BR')}</p><div className="admin-list-card__footer"><span>{list.publishedAt ? `Publicada em ${new Date(list.publishedAt).toLocaleDateString('pt-BR')}` : 'Revisão necessária antes de publicar'}</span><ArrowRight size={17} /></div></Link>{['RASCUNHO', 'ENCERRADA'].includes(list.status) && <button className="admin-list-card__archive" type="button" disabled={archivingId !== null} onClick={() => void archive(list)}><Archive size={15} /> {archivingId === list.id ? 'Arquivando…' : 'Arquivar'}</button>}</article>)}</div>{nextCursor && <div className="history-load-more"><button className="button button--secondary" type="button" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? 'Carregando…' : moreFailed ? 'Tentar carregar novamente' : 'Carregar mais listas'}</button></div>}</>
      : <AdminEmpty title="Nenhuma lista por aqui" detail="Comece importando uma foto, PDF, planilha ou texto. A lista só será publicada depois da sua revisão." to="/admin/listas/nova" link="Criar primeira lista" />}
  </div>;
}
