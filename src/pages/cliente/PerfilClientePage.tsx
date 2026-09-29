import { useState } from 'react';
import { ArrowRight, CircleUserRound, Pencil, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BuscarPerfil } from '../../features/cliente/components/BuscarPerfil';
import { clienteRepository } from '../../features/cliente/cliente.repository';
import { lerSessaoCliente, removerSessaoCliente, salvarSessaoCliente } from '../../infra/local-storage/cliente-session';
import { useToast } from '../../components/ui/Toast';

export function PerfilClientePage() {
  const [session, setSession] = useState(() => lerSessaoCliente());
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(session?.nome ?? '');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [error, setError] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  async function save() {
    if (!session) return;
    setSaving(true); setError('');
    try {
      const profile = await clienteRepository.updateMyProfile(session.token, { nome: name, telefone: phone });
      const updated = { ...session, nome: profile.nome };
      salvarSessaoCliente(updated); setSession(updated); setEditing(false); setPhone(''); toast('Perfil atualizado.');
    } catch { setError('Não foi possível atualizar o perfil. Confira o telefone e tente novamente.'); }
    finally { setSaving(false); }
  }

  async function logout() {
    if (!session || loggingOut) return;
    setLoggingOut(true); setLogoutError('');
    try {
      await clienteRepository.logout(session.token);
      removerSessaoCliente(); setSession(null); setEditing(false);
    } catch {
      setLogoutError('Não foi possível encerrar a sessão agora. Verifique a conexão e tente novamente.');
    } finally { setLoggingOut(false); }
  }

  return (
    <div className="customer-page page-wrap">
      <div className="page-kicker"><span className="eyebrow">04 · SUA IDENTIDADE</span><span className="page-count">PERFIL / CLIENTE</span></div>
      <header className="customer-heading"><div><span className="eyebrow">PERFIL</span><h1>Seu perfil,<br /><em>do seu jeito.</em></h1></div><CircleUserRound className="customer-heading__icon" size={36} /></header>
      {!session ? <section className="identity-panel"><div className="identity-panel__intro"><span className="identity-icon"><ShieldCheck size={21} /></span><div><h2>Acesse seu perfil</h2><p>Use seu nome e telefone. Sem senha ou e-mail.</p></div></div><BuscarPerfil onAuthenticated={(next) => { setSession(next); setName(next.nome); navigate('/cliente/perfil'); }} /></section>
        : <section className="profile-card"><div className="profile-card__top"><span className="profile-avatar">{session.nome.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><span className="eyebrow">CLIENTE DA BANCA</span><h2>{session.nome}</h2><p>Telefone protegido</p></div>{!editing && <button className="icon-button" type="button" aria-label="Editar perfil" onClick={() => setEditing(true)}><Pencil size={18} /></button>}</div>
          {editing ? <div className="form-stack profile-edit"><label className="field-label">Nome<Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Novo telefone com DDD<Input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(17) 99999-0000" /></label><div className="button-row"><Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button><Button disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar perfil'} <ArrowRight size={16} /></Button></div>{error && <p className="form-error" role="alert">{error}</p>}</div>
            : <div className="profile-links"><Link to="/cliente/reservas"><span>Minhas reservas</span><ArrowRight size={17} /></Link><Link to="/cliente/notificacoes"><span>Notificações</span><ArrowRight size={17} /></Link></div>}
        </section>}
      {session && <><button type="button" className="text-button signout-link" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? 'Encerrando…' : 'Sair deste dispositivo'}</button>{logoutError && <p className="form-error" role="alert">{logoutError}</p>}</>}
    </div>
  );
}
