import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Save, Settings2 } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { adminRepository, type DadosBancaAdmin } from '../../features/admin/admin.repository';
import { AdminLoadError, AdminLoading } from './AdminCommon';

export function ConfiguracoesPage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [data, setData] = useState<DadosBancaAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!user) return;
    try { setData(await adminRepository.getBanca(user)); setFailed(false); } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || !user) return;
    setSaving(true);
    try { setData(await adminRepository.updateBanca(user, data)); toast('Configurações operacionais salvas.'); }
    catch { toast('Não foi possível salvar as configurações.', 'info'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="admin-page"><AdminLoading /></div>;
  if (failed || !data) return <div className="admin-page"><AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /></div>;
  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="eyebrow">09 · OPERAÇÃO / PREFERÊNCIAS</span><h1>Configurações.</h1><p>Prazos prudentes ajudam a organizar reservas e recolhimentos.</p></div><Settings2 size={30} /></header>
    <form className="admin-form-card admin-settings-form" onSubmit={(event) => void save(event)}>
      <div className="setting-row"><div><strong>Tolerância de retirada</strong><p>Dias adicionais depois da data escolhida antes da reserva expirar.</p></div><label><Input type="number" min={0} max={9} step={1} value={data.toleranciaRetiradaDias} onChange={(event) => setData({ ...data, toleranciaRetiradaDias: Math.max(0, Number(event.target.value)) })} /><span>dias</span></label></div>
      <div className="setting-row"><div><strong>Margem antes do recolhimento</strong><p>Interrompe novas reservas com esta antecedência para fechar o lote com segurança.</p></div><label><Input type="number" min={0} max={14} step={1} value={data.margemRecolhimentoDias} onChange={(event) => setData({ ...data, margemRecolhimentoDias: Math.max(0, Number(event.target.value)) })} /><span>dias</span></label></div>
      <div className="admin-form-footer"><span>O servidor valida cada reserva com os limites atuais do lote.</span><Button disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar configurações <ArrowRight size={16} /></Button></div>
    </form>
  </div>;
}
