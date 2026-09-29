import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Eye, LoaderCircle, Save, Send } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useAdminAuth } from '../../app/providers';
import { ExportarLista } from '../../features/listas/components/ExportarLista';
import { TabelaRevisao } from '../../features/listas/components/TabelaRevisao';
import { PreviewLista } from '../../features/listas/components/PreviewLista';
import type { ImportedListRow } from '../../features/importacao/importacao.types';
import type { ExportableList } from '../../features/exportacao/exportacao.types';
import { adminRepository } from '../../features/admin/admin.repository';
import { mapAdminItemsToImportedRows, toAdminListItemInput } from '../../features/listas/lista.mappers';
import { useToast } from '../../components/ui/Toast';
import { AdminLoadError, AdminLoading } from './AdminCommon';

export function RevisarListaPage() {
  const { listaId = '' } = useParams();
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('RASCUNHO');
  const [rows, setRows] = useState<ImportedListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await adminRepository.getList(user, listaId);
      setFailed(false);
      setTitle(result.list.title); setStatus(result.list.status);
      setRows(mapAdminItemsToImportedRows(result.items));
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user, listaId]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const payload = useMemo(() => ({ title, items: rows.map(toAdminListItemInput) }), [title, rows]);

  const save = useCallback(async () => {
    if (!user || !title.trim()) return false;
    setSaving(true);
    try { await adminRepository.updateList(user, listaId, payload); return true; }
    catch { toast('Não foi possível salvar as alterações.', 'info'); return false; }
    finally { setSaving(false); }
  }, [user, listaId, payload, title, toast]);

  useEffect(() => {
    if (loading || status !== 'RASCUNHO' || !rows.length) return;
    const timer = window.setTimeout(() => { void save(); }, 1000);
    return () => window.clearTimeout(timer);
  }, [rows, title, status, loading, save]);

  async function publish() {
    if (!user || status !== 'RASCUNHO') return;
    if (rows.some((row) => !row.title.trim() || row.quantity == null || row.quantity < 0)) {
      toast('Informe título e quantidade em todas as linhas antes de publicar.', 'info');
      return;
    }
    if (rows.some((row) => row.requiresReview)) {
      toast('Marque cada linha como conferida antes de publicar.', 'info');
      return;
    }
    setPublishing(true);
    const saved = await save();
    if (!saved) { setPublishing(false); return; }
    try { await adminRepository.publishList(user, listaId); setStatus('PUBLICADA'); toast('Lista publicada no catálogo.'); await load(); }
    catch { toast('A publicação foi recusada. Revise os dados do lote e tente novamente.', 'info'); }
    finally { setPublishing(false); }
  }

  const exportable: ExportableList = { title, storeName: 'Banca Ana Maria', items: rows.map((row) => ({ title: row.title, volume: row.volume, price: row.price, quantity: row.quantity, code: row.code })) };

  if (loading) return <div className="admin-page"><AdminLoading label="Abrindo lista para revisão…" /></div>;
  if (failed) return <div className="admin-page"><Link className="back-link" to="/admin/listas"><ArrowLeft size={17} /> Voltar às listas</Link><AdminLoadError onRetry={() => void load()} /></div>;

  return <div className="admin-page">
    <Link className="back-link" to="/admin/listas"><ArrowLeft size={17} /> Todas as listas</Link>
    <header className="admin-page-heading admin-page-heading--stack"><div><span className="eyebrow">REVISÃO / {listaId.slice(0, 8).toUpperCase()}</span><h1>{title}</h1><p>Revise quantidade, volume e confiança antes de publicar no catálogo.</p></div><Badge tone={status === 'PUBLICADA' ? 'lime' : 'orange'}>{status}</Badge></header>
    <div className="review-panel">
      <div className="review-panel__heading"><span className="eyebrow">{rows.length} LINHAS PARA CONFERIR</span><Button variant="secondary" size="small" onClick={() => setPreview((value) => !value)}><Eye size={16} /> {preview ? 'Editar dados' : 'Prévia do cliente'}</Button></div>
      {preview ? <PreviewLista title={title} rows={rows} /> : <TabelaRevisao rows={rows} onChange={setRows} />}
      <div className="review-actions"><span>{saving ? <><LoaderCircle className="spin" size={14} /> Salvando automaticamente…</> : <><Check size={14} /> Alterações salvas em segundo plano</>}</span><div><Button variant="secondary" disabled={saving} onClick={() => void save()}><Save size={16} /> Salvar agora</Button>{status === 'RASCUNHO' && <Button disabled={saving || publishing} onClick={() => void publish()}><Send size={16} /> {publishing ? 'Publicando…' : 'Publicar catálogo'}</Button>}</div></div>
    </div>
    <div className="export-panel"><ExportarLista list={exportable} /></div>
    {status === 'PUBLICADA' && <p className="success-note">Esta lista está publicada. Alterações futuras serão auditadas no histórico. <button type="button" className="text-button" onClick={() => navigate('/admin/historico')}>Ver histórico</button></p>}
  </div>;
}
