import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type ReparteAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

export function RecolhimentosPage() {
  const { user } = useAdminAuth();
  const [items, setItems] = useState<ReparteAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setItems(await adminRepository.repartes(user)); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <div className="admin-page">
    <AdminHeading kicker="06 · ESTOQUE / RECOLHIMENTO" title="Feche cada lote com clareza." description="Conte o que está fisicamente na banca antes de confirmar a devolução." />
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : items.length ? <div className="admin-list-grid">{items.map((item) => <Link className="admin-list-card" to={`/admin/recolhimentos/${item.id}`} key={item.id}><div className="admin-list-card__top"><Badge tone={item.status === 'AGUARDANDO_RECOLHIMENTO' ? 'orange' : item.status === 'ENCERRADO' ? 'muted' : 'lime'}>{item.status.replaceAll('_', ' ')}</Badge><span>{item.itemCount ?? '—'} itens</span></div><h2>{item.title}</h2><p><CalendarDays size={14} /> {item.plannedCollectionAt ? new Date(item.plannedCollectionAt).toLocaleDateString('pt-BR') : 'Data não cadastrada'}</p><div className="admin-list-card__footer"><span>Registrar conferência física</span><ArrowRight size={17} /></div></Link>)}</div>
      : <AdminEmpty title="Nenhum lote ativo" detail="Lotes e datas de recolhimento aparecem aqui quando listas são publicadas." />}
  </div>;
}
