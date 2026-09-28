import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FilePlus2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type ListaAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

const filters = ['TODAS', 'RASCUNHO', 'PUBLICADA', 'ENCERRADA', 'ARQUIVADA'] as const;

export function ListasPage() {
  const { user } = useAdminAuth();
  const [status, setStatus] = useState<(typeof filters)[number]>('TODAS');
  const [lists, setLists] = useState<ListaAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setLists(await adminRepository.lists(user, status === 'TODAS' ? undefined : status)); setFailed(false); } catch { setFailed(true); } finally { setLoading(false); }
  }, [user, status]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <div className="admin-page">
    <AdminHeading kicker="02 · CATÁLOGO / LISTAS" title="Listas da banca." description="Importe, revise, publique e acompanhe cada lote." action={<Link className="button button--primary" to="/admin/listas/nova"><FilePlus2 size={16} /> Criar lista</Link>} />
    <div className="admin-filter-row">{filters.map((item) => <button key={item} type="button" className={`filter-pill${status === item ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setStatus(item); }}>{item === 'TODAS' ? 'Todas' : item.toLowerCase()}</button>)}</div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : lists.length ? <div className="admin-list-grid">{lists.map((list) => <Link className="admin-list-card" to={`/admin/listas/${list.id}`} key={list.id}><div className="admin-list-card__top"><Badge tone={list.status === 'PUBLICADA' ? 'lime' : list.status === 'RASCUNHO' ? 'orange' : 'muted'}>{list.status}</Badge><span>{list.totalItems} itens</span></div><h2>{list.title}</h2><p>Criada em {new Date(list.createdAt).toLocaleDateString('pt-BR')}</p><div className="admin-list-card__footer"><span>{list.publishedAt ? `Publicada em ${new Date(list.publishedAt).toLocaleDateString('pt-BR')}` : 'Revisão necessária antes de publicar'}</span><ArrowRight size={17} /></div></Link>)}</div>
      : <AdminEmpty title="Nenhuma lista por aqui" detail="Comece importando uma foto, PDF, planilha ou texto. A lista só será publicada depois da sua revisão." to="/admin/listas/nova" link="Criar primeira lista" />}
  </div>;
}
