import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Save, Store } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { adminRepository, type DadosBancaAdmin } from '../../features/admin/admin.repository';
import { AdminLoadError, AdminLoading } from './AdminCommon';

const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

export function PerfilBancaPage() {
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

  function update<K extends keyof DadosBancaAdmin>(key: K, value: DadosBancaAdmin[K]) {
    setData((current) => current ? { ...current, [key]: value } : current);
  }
  function updateHours(day: number, partial: Partial<DadosBancaAdmin['horarios'][number]>) {
    if (!data) return;
    const next = data.horarios.some((entry) => entry.diaSemana === day)
      ? data.horarios.map((entry) => entry.diaSemana === day ? { ...entry, ...partial } : entry)
      : [...data.horarios, { diaSemana: day, fechado: false, abre: '08:00', fecha: '18:00', ...partial }];
    update('horarios', next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || !user) return;
    setSaving(true);
    try { setData(await adminRepository.updateBanca(user, data)); toast('Perfil da banca atualizado.'); }
    catch { toast('Não foi possível salvar as informações.', 'info'); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="admin-page"><AdminLoading /></div>;
  if (failed || !data) return <div className="admin-page"><AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /></div>;

  return <div className="admin-page">
    <header className="admin-page-heading"><div><span className="eyebrow">08 · IDENTIDADE / DADOS PÚBLICOS</span><h1>Perfil da banca.</h1><p>Estas informações aparecem no catálogo e na página de localização.</p></div><Store size={30} /></header>
    <form className="admin-form-card" onSubmit={(event) => void save(event)}><div className="admin-form-section"><h2>Informações públicas</h2><p>Não inclua redes sociais que ainda não foram confirmadas.</p><label className="field-label">Nome de exibição<Input value={data.nomeExibicao} onChange={(event) => update('nomeExibicao', event.target.value)} required /></label><label className="field-label">Telefone / WhatsApp<Input inputMode="tel" value={data.telefone} onChange={(event) => update('telefone', event.target.value)} required /></label><label className="field-label">Endereço<Input value={data.endereco} onChange={(event) => update('endereco', event.target.value)} required /></label></div>
      <div className="admin-form-section"><h2>Horários de funcionamento</h2><p>Edite os dias especiais conforme a rotina da banca.</p><div className="hours-editor">{weekdays.map((day, index) => { const entry = data.horarios.find((item) => item.diaSemana === index) ?? { diaSemana: index, fechado: index === 0, abre: index === 6 ? '08:00' : '08:00', fecha: index === 6 ? '13:00' : '18:00' }; return <div className="hours-editor__row" key={day}><strong>{day}</strong><label className="closed-toggle"><input type="checkbox" checked={entry.fechado} onChange={(event) => updateHours(index, { fechado: event.target.checked })} /><span>Fechado</span></label><Input aria-label={`${day}, abre`} type="time" value={entry.abre ?? ''} disabled={entry.fechado} onChange={(event) => updateHours(index, { abre: event.target.value })} /><Input aria-label={`${day}, fecha`} type="time" value={entry.fecha ?? ''} disabled={entry.fechado} onChange={(event) => updateHours(index, { fecha: event.target.value })} /></div>; })}</div></div>
      <div className="admin-form-footer"><span><span className="static-photo-mark">▧</span> Foto da banca é um arquivo estático; para trocar, atualize `public/banca/`.</span><Button disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Salvar perfil <ArrowRight size={16} /></Button></div>
    </form>
  </div>;
}
