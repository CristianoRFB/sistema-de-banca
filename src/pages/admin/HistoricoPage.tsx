import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, History } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { useAdminAuth } from '../../app/providers';
import { adminRepository } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

type HistoryType = 'sales' | 'returns' | 'changes';
const tabs: Array<{ value: HistoryType; label: string }> = [
  { value: 'sales', label: 'Retiradas / vendas' }, { value: 'returns', label: 'Devoluções' }, { value: 'changes', label: 'Alterações' },
];

function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function text(value: unknown, fallback = 'Registro da banca') { return typeof value === 'string' && value ? value : fallback; }
function formatHistoryDate(value: unknown) {
  if (typeof value !== 'string') return 'Data não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistoricoPage() {
  const { user } = useAdminAuth();
  const [tab, setTab] = useState<HistoryType>('sales');
  const [records, setRecords] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setRecords(await adminRepository.history(user, tab)); setFailed(false); } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user, tab]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <div className="admin-page">
    <AdminHeading kicker="07 · AUDITORIA / HISTÓRICO" title="O passado fica registrado." description="Retiradas, devoluções e alterações preservam o contexto de cada movimento." />
    <div className="admin-filter-row">{tabs.map((item) => <button key={item.value} type="button" className={`filter-pill${tab === item.value ? ' is-selected' : ''}`} onClick={() => { setLoading(true); setFailed(false); setTab(item.value); }}>{item.label}</button>)}</div>
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => void load()} /> : records.length ? <div className="history-list">{records.map((record, index) => {
      const row = asRecord(record);
      const title = text(row.productTitle ?? row.titleSnapshot ?? row.title ?? row.entityType, tab === 'changes' ? 'Alteração registrada' : 'Movimentação de estoque');
      const date = row.confirmedAt ?? row.returnedAt ?? row.createdAt ?? row.changedAt;
      const detail = text(row.customerName ?? row.description ?? row.reason ?? row.type, tab === 'sales' ? 'Retirada confirmada pela equipe' : tab === 'returns' ? 'Devolução registrada na conferência' : 'Alteração auditada');
      const quantity = typeof row.quantity === 'number' ? row.quantity : null;
      return <article className="history-card" key={text(row.id, String(index))}><span className="history-card__icon"><History size={18} /></span><div className="history-card__body"><span className="eyebrow">{formatHistoryDate(date)}</span><h2>{title}</h2><p>{detail}</p></div><div className="history-card__right">{quantity != null && <Badge tone="muted">{quantity} un.</Badge>}<ArrowUpRight size={16} /></div></article>;
    })}</div> : <AdminEmpty title="Nenhum registro neste período" detail="Os registros aparecem aqui depois de uma retirada, devolução ou alteração." />}
  </div>;
}
