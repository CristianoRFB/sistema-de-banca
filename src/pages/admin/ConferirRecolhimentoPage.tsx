import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clock3, LoaderCircle, PackageCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAdminAuth } from '../../app/providers';
import { adminRepository, type ReconciliationAdmin } from '../../features/admin/admin.repository';
import { useToast } from '../../components/ui/Toast';
import { AdminLoadError, AdminLoading } from './AdminCommon';

const reasons = [
  { value: 'VENDA_NAO_REGISTRADA', label: 'Venda não registrada' },
  { value: 'RETIRADA_NAO_REGISTRADA', label: 'Retirada não registrada' },
  { value: 'PERDA_OU_AVARIA', label: 'Perda ou avaria' },
  { value: 'ERRO_CONFERENCIA', label: 'Erro de conferência' },
  { value: 'MANTER_PENDENTE', label: 'Manter pendente para investigação' },
  { value: 'OUTRO', label: 'Outro motivo' },
];

export function ConferirRecolhimentoPage() {
  const { reparteId = '' } = useParams();
  const { user } = useAdminAuth();
  const toast = useToast();
  const [data, setData] = useState<ReconciliationAdmin | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [reasonNotes, setReasonNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await adminRepository.reconciliation(user, reparteId);
      setData(result);
      setFailed(false);
      setCounts(Object.fromEntries(result.items.map((item) => [item.itemReparteId, item.quantityFound == null ? '' : String(item.quantityFound)])));
      setWhy(Object.fromEntries(result.items.filter((item) => item.resolution).map((item) => [item.itemReparteId, item.resolution ?? ''])));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user, reparteId]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!user || !data) return;
    const uncounted = data.items.find((item) => counts[item.itemReparteId] === undefined || counts[item.itemReparteId] === '');
    if (uncounted) { toast(`Informe a contagem física de ${uncounted.title}.`, 'info'); return; }
    const unresolved = data.items.find((item) => Number(counts[item.itemReparteId]) !== item.quantityExpected && (!why[item.itemReparteId] || (why[item.itemReparteId] === 'OUTRO' && !reasonNotes[item.itemReparteId]?.trim())));
    if (unresolved) { toast(`Informe o motivo da diferença em ${unresolved.title}.`, 'info'); return; }
    setSaving(true);
    try {
      await adminRepository.reconcile(user, reparteId, data.items.map((item) => {
        const resolution = why[item.itemReparteId];
        const label = reasons.find((reason) => reason.value === resolution)?.label ?? resolution;
        const note = reasonNotes[item.itemReparteId]?.trim();
        return {
          itemReparteId: item.itemReparteId,
          quantityFound: Number(counts[item.itemReparteId]),
          ...(resolution ? { resolution, reason: note || label || resolution } : {}),
        };
      }));
      toast(data.items.some((item) => why[item.itemReparteId] === 'MANTER_PENDENTE') ? 'Contagem salva. O lote ficará aberto para investigação.' : 'Contagem registrada com histórico de movimentação.');
      await load();
    } catch { toast('Não foi possível salvar. Confira a contagem e tente novamente.', 'info'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="admin-page"><AdminLoading label="Abrindo a conferência do lote…" /></div>;
  if (failed || !data) return <div className="admin-page"><Link className="back-link" to="/admin/recolhimentos"><ArrowLeft size={17} /> Recolhimentos</Link><AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /></div>;
  const differenceCount = data.items.filter((item) => counts[item.itemReparteId] !== '' && Number(counts[item.itemReparteId]) !== item.quantityExpected).length;
  const uncountedCount = data.items.filter((item) => counts[item.itemReparteId] === '').length;

  return <div className="admin-page">
    <Link className="back-link" to="/admin/recolhimentos"><ArrowLeft size={17} /> Recolhimentos</Link>
    <header className="admin-page-heading admin-page-heading--stack"><div><span className="eyebrow">CONFERÊNCIA FÍSICA / {reparteId.slice(0, 8).toUpperCase()}</span><h1>{data.reparte.title}</h1><p>O saldo esperado orienta a contagem. A quantidade encontrada representa a realidade da banca.</p></div></header>
    <div className="reconciliation-note"><AlertTriangle size={18} /><span>{data.collection?.status === 'COM_DIVERGENCIA' ? 'Este lote tem saldo pendente. Conte o saldo que ainda falta conferir; use zero se nada mais estiver na banca e escolha manter pendente ou o motivo que encerra a diferença.' : 'Se a contagem divergir, registre o número encontrado e escolha um motivo. O sistema manterá o histórico antes e depois.'}</span></div>
    <div className="reconciliation-list">{data.items.map((item) => {
      const rawCount = counts[item.itemReparteId] ?? '';
      const count = rawCount === '' ? null : Number(rawCount);
      const difference = count !== null && count !== item.quantityExpected;
      const resolutionOptions = count !== null && count > item.quantityExpected ? [{ value: 'AJUSTE_POSITIVO', label: 'Sobra: ajuste positivo' }] : reasons;
      return <article className={`reconciliation-item${difference ? ' has-difference' : ''}`} key={item.itemReparteId}><div className="reconciliation-item__title"><span className="reservation-item__mark">読</span><span><strong>{item.title}</strong><small>{item.volume ? `Vol. ${item.volume} · ` : ''}Esperado pelo sistema: {item.quantityExpected}{item.pending ? ' · divergência pendente' : ''}</small></span></div><label className="field-label">Encontrado<input className="input count-input" type="number" min={0} step={1} inputMode="numeric" placeholder="Informe a contagem" value={rawCount} onChange={(event) => setCounts((current) => ({ ...current, [item.itemReparteId]: event.target.value === '' ? '' : String(Math.max(0, Math.floor(Number(event.target.value)))) }))} /></label>{difference && <><label className="field-label">Motivo da diferença<select className="input" value={why[item.itemReparteId] ?? ''} onChange={(event) => setWhy((current) => ({ ...current, [item.itemReparteId]: event.target.value }))}><option value="">Escolher motivo</option>{resolutionOptions.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>{why[item.itemReparteId] === 'OUTRO' && <label className="field-label">Explique o motivo<input className="input" maxLength={240} value={reasonNotes[item.itemReparteId] ?? ''} onChange={(event) => setReasonNotes((current) => ({ ...current, [item.itemReparteId]: event.target.value }))} /></label>}</>}{item.pending && count !== null && count !== item.quantityExpected && why[item.itemReparteId] === 'MANTER_PENDENTE' && <p className="field-hint">A quantidade encontrada será registrada; o lote continuará aberto para uma nova conferência.</p>}<div className="reconciliation-item__status">{difference ? <><AlertTriangle size={15} /> Diferença de {count - item.quantityExpected}</> : count === null ? <><Clock3 size={15} /> Aguardando contagem física</> : <><Check size={15} /> Confere</>}</div></article>;
    })}</div>
    <div className="reconciliation-footer"><span><PackageCheck size={16} /> {uncountedCount ? `${uncountedCount} item(ns) aguardam contagem` : differenceCount ? `${differenceCount} diferença(s) registrada(s)` : 'Contagem sem diferenças'}</span><Button disabled={saving || data.items.length === 0 || uncountedCount > 0} onClick={() => void submit()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />} Registrar contagem</Button></div>
  </div>;
}
