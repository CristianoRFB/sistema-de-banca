import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Cloud, Eye, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAdminAuth } from '../../app/providers';
import { ExportarLista } from '../../features/listas/components/ExportarLista';
import { ImportarArquivo } from '../../features/listas/components/ImportarArquivo';
import { TabelaRevisao } from '../../features/listas/components/TabelaRevisao';
import type { ImportDraft, ImportedListRow } from '../../features/importacao/importacao.types';
import type { ExportableList } from '../../features/exportacao/exportacao.types';
import { adminRepository } from '../../features/admin/admin.repository';
import { attachSavedItemIdentities, hasCompleteSavedItemIdentities, toAdminListItemInput } from '../../features/listas/lista.mappers';

interface SavedDraft { listaId?: string; title: string; draft: ImportDraft }
const STORAGE_KEY = 'banca-admin-list-draft:v1';

function restoreDraft(): SavedDraft | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as SavedDraft : null; } catch { return null; }
}

export function NovaListaPage() {
  const { user } = useAdminAuth();
  const navigate = useNavigate();
  const [restored] = useState(restoreDraft);
  const [title, setTitle] = useState(restored?.title ?? `Lançamentos · ${new Date().toLocaleDateString('pt-BR')}`);
  const [draft, setDraft] = useState<ImportDraft | null>(restored?.draft ?? null);
  const [listaId, setListaId] = useState<string | undefined>(restored?.listaId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [hydratingIds, setHydratingIds] = useState(() => Boolean(restored?.listaId));
  const [identitySyncFailed, setIdentitySyncFailed] = useState(false);
  const savingRef = useRef(false);

  const exportable = useMemo<ExportableList>(() => ({
    title,
    items: (draft?.rows ?? []).map((row) => ({ title: row.title, volume: row.volume, price: row.price, quantity: row.quantity, code: row.code })),
    subtitle: 'Novidades na Banca Ana Maria',
    createdAt: draft?.createdAt,
    storeName: 'Banca Ana Maria',
  }), [draft, title]);

  function persistLocally(value: ImportDraft, currentTitle: string, id?: string) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ listaId: id, title: currentTitle, draft: value } satisfies SavedDraft)); } catch { /* Browser storage can be disabled; online save is still available. */ }
  }

  useEffect(() => {
    if (!restored?.listaId || !user) return;
    let active = true;
    adminRepository.getList(user, restored.listaId).then((saved) => {
      if (!active) return;
      const restoredRows = restored?.draft.rows;
      const rowsWithIdentity = restoredRows ? attachSavedItemIdentities(restoredRows, saved.items) : [];
      if (!restoredRows || !hasCompleteSavedItemIdentities(rowsWithIdentity, saved.items)) {
        throw new Error('saved_list_identity_mismatch');
      }
      setDraft((current) => current ? { ...current, rows: rowsWithIdentity } : current);
      setIdentitySyncFailed(false);
    }).catch(() => {
      if (active) {
        setIdentitySyncFailed(true);
        setSaveError('Não foi possível associar todas as linhas locais aos itens salvos. Abra a lista salva para continuar sem duplicar ou alterar itens de estoque incorretos.');
      }
    }).finally(() => {
      if (active) setHydratingIds(false);
    });
    return () => { active = false; };
  }, [restored, user]);

  async function saveDraft(rows = draft?.rows, currentTitle = title) {
    if (!user || !draft || !rows || savingRef.current || hydratingIds || identitySyncFailed) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    const input = {
      title: currentTitle.trim(),
      source: draft.source,
      items: rows.map(toAdminListItemInput),
    };
    try {
      const saved = listaId
        ? await adminRepository.updateList(user, listaId, input)
        : await adminRepository.createList(user, input);
      setListaId(saved.listId);
      try {
        const savedList = await adminRepository.getList(user, saved.listId);
        const rowsWithIdentity = attachSavedItemIdentities(rows, savedList.items);
        if (!hasCompleteSavedItemIdentities(rowsWithIdentity, savedList.items)) {
          throw new Error('saved_list_identity_mismatch');
        }
        const identityByRow = new Map(rows.map((row, index) => [row.id, rowsWithIdentity[index]]));
        setDraft((current) => current
          ? { ...current, rows: current.rows.map((row) => {
            const savedRow = identityByRow.get(row.id);
            return savedRow ? { ...row, id: savedRow.id, itemReparteId: savedRow.itemReparteId, productId: savedRow.productId } : row;
          }) }
          : current);
        setIdentitySyncFailed(false);
      } catch {
        setIdentitySyncFailed(true);
        setSaveError('O rascunho foi salvo, mas não foi possível associar todas as linhas aos itens salvos. Abra a lista salva para continuar com segurança.');
        persistLocally({ ...draft, rows }, currentTitle, saved.listId);
        return;
      }
      setLastSaved(new Date());
    } catch {
      persistLocally({ ...draft, rows }, currentTitle, listaId);
      setSaveError('Rascunho guardado neste dispositivo. A sincronização com a banca falhou; confira a conexão antes de publicar.');
    } finally { savingRef.current = false; setSaving(false); }
  }

  useEffect(() => {
    if (!draft) return;
    persistLocally(draft, title, listaId);
    if (!listaId || !user || hydratingIds || identitySyncFailed) return;
    const timer = window.setTimeout(() => { void saveDraft(draft.rows, title); }, 900);
    return () => window.clearTimeout(timer);
  // Save whenever the title, rows or server identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, title, listaId, user, hydratingIds, identitySyncFailed]);

  function acceptDraft(next: ImportDraft) {
    setDraft(next);
    setShowPreview(false);
    persistLocally(next, title, listaId);
  }

  function updateRows(rows: ImportedListRow[]) {
    if (!draft) return;
    setDraft({ ...draft, rows });
  }

  return <div className="admin-page">
    <Link className="back-link" to="/admin/listas"><ArrowLeft size={17} /> Voltar às listas</Link>
    <header className="admin-page-heading admin-page-heading--stack"><div><span className="eyebrow">03 · NOVA LISTA / RASCUNHO</span><h1>Da chegada<br />à <em>prateleira.</em></h1><p>Importe, revise cada linha e só publique quando estiver conferido.</p></div></header>
    <div className="list-editor-title"><label className="field-label">Nome da lista<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} /></label><div className="autosave-status">{hydratingIds ? <><Cloud size={15} /> Sincronizando itens…</> : saving ? <><Cloud size={15} /> Salvando…</> : lastSaved ? <><Check size={15} /> Salvo às {lastSaved.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</> : <><Save size={15} /> Rascunho neste dispositivo</>}</div></div>
    {!draft && <section className="import-panel"><div className="step-label"><span>01</span><div><span className="eyebrow">ORIGEM DA LISTA</span><p>O arquivo será lido neste aparelho e descartado depois da importação.</p></div></div><ImportarArquivo onDraftReady={acceptDraft} /></section>}
    {draft && <>
      <section className="review-panel"><div className="review-panel__heading"><div className="step-label"><span>02</span><div><span className="eyebrow">REVISE ANTES DE PUBLICAR</span><p>{draft.rows.length} linhas · {draft.sourceName ?? 'entrada manual'} · {draft.warnings.length} avisos</p></div></div><Button variant="secondary" size="small" onClick={() => setShowPreview((value) => !value)}><Eye size={16} /> {showPreview ? 'Fechar prévia' : 'Ver como cliente'}</Button></div>
        {draft.warnings.length > 0 && <div className="review-warning" role="status">{draft.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        {showPreview ? <div className="customer-preview"><span className="eyebrow">PRÉVIA DO CATÁLOGO</span><h2>{title}</h2><div className="preview-products">{draft.rows.map((row) => <div className="preview-product" key={row.id}><span>読</span><strong>{row.title}</strong><small>{row.volume ? `Vol. ${row.volume}` : 'Volume não informado'}</small></div>)}</div></div> : <TabelaRevisao rows={draft.rows} onChange={updateRows} disabled={hydratingIds || identitySyncFailed} />}
        <div className="review-actions"><span>{hydratingIds ? 'Sincronizando os itens já salvos…' : identitySyncFailed ? 'Abra a lista salva para continuar com segurança.' : `${draft.rows.filter((row) => row.requiresReview || row.issues.length).length} linhas ainda pedem conferência`}</span><div><Button variant="secondary" onClick={() => void saveDraft()} disabled={saving || hydratingIds || identitySyncFailed || !title.trim()}><Save size={16} /> Salvar rascunho</Button><Button onClick={() => { if (listaId) navigate(`/admin/listas/${listaId}`); else void saveDraft(); }} disabled={saving || hydratingIds || !listaId}><ArrowRight size={16} /> Continuar revisão</Button></div></div>
      </section>
      <div className="export-panel"><ExportarLista list={exportable} /></div>
    </>}
    {saveError && <p className="form-error" role="alert">{saveError}</p>}
    {!user && <p className="form-error" role="alert">Sessão administrativa necessária para sincronizar este rascunho.</p>}
  </div>;
}
