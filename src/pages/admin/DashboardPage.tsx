import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, Clock3, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type DashboardSummary } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

export function DashboardPage() {
  const { user } = useAdminAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setSummary(await adminRepository.dashboard(user)); setFailed(false); } catch { setFailed(true); } finally { setLoading(false); }
  }, [user]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return <div className="admin-page">
    <AdminHeading kicker="01 · VISÃO GERAL" title="Bom dia, equipe." description="Aqui está o que pede atenção na banca hoje." action={<Link className="button button--primary" to="/admin/listas/nova"><Plus size={16} /> Nova lista</Link>} />
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : <>
      <section className="admin-section-label"><span className="eyebrow">RETIRADAS DE HOJE</span><Link to="/admin/retiradas">Ver agenda completa <ArrowRight size={15} /></Link></section>
      <div className="metric-grid">
        <Metric icon={<CalendarDays />} label="Previstas hoje" value={summary?.retiradasHoje ?? 0} tone="dark" />
        <Metric icon={<Check />} label="Vão buscar" value={summary?.confirmaramPresenca ?? 0} tone="lime" />
        <Metric icon={<ArrowRight />} label="Estão a caminho" value={summary?.estaoACaminho ?? 0} tone="orange" />
        <Metric icon={<Clock3 />} label="Sem resposta" value={summary?.semResposta ?? 0} tone="light" />
      </div>
      <div className="admin-dashboard-grid">
        <section className="admin-dashboard-card"><div className="admin-section-label"><span className="eyebrow">PRECISAM DE ATENÇÃO</span><Bell size={17} /></div>
          {(summary?.recolhimentosProximos ?? 0) > 0 ? <Link className="admin-alert-line" to="/admin/recolhimentos"><span className="alert-symbol">!</span><span><strong>{summary?.recolhimentosProximos} recolhimentos próximos</strong><small>Confira os lotes e prepare a contagem física.</small></span><ArrowRight size={16} /></Link> : <AdminEmpty title="Nenhum recolhimento próximo" detail="A banca está em dia com as conferências de lote." />}
          <Link className="admin-card-footer" to="/admin/recolhimentos">Abrir recolhimentos <ArrowRight size={15} /></Link>
        </section>
        <section className="admin-dashboard-card"><div className="admin-section-label"><span className="eyebrow">LISTAS DE LANÇAMENTOS</span><BookOpen size={17} /></div>
          <div className="list-counts"><div><strong>{summary?.listasRascunho ?? 0}</strong><span>em rascunho</span></div><div><strong>{summary?.listasPublicadas ?? 0}</strong><span>publicadas</span></div></div>
          <Link className="admin-card-footer" to="/admin/listas">Gerenciar listas <ArrowRight size={15} /></Link>
        </section>
      </div>
    </>}
  </div>;
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <div className={`metric-card metric-card--${tone}`}><span className="metric-card__icon">{icon}</span><strong>{value}</strong><span>{label}</span></div>;
}
