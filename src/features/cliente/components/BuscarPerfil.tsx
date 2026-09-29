import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, UserRound } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { clienteRepository } from '../cliente.repository';
import { salvarSessaoCliente } from '../../../infra/local-storage/cliente-session';
import type { PerfilMascarado, SessaoCliente } from '../cliente.types';

const PROFILE_CONFIRMATION_ERROR = 'Não foi possível confirmar o perfil. Revise nome e telefone ou fale com a banca.';

export function BuscarPerfil({ onAuthenticated }: { onAuthenticated: (session: SessaoCliente) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [matches, setMatches] = useState<PerfilMascarado[]>([]);
  const [selected, setSelected] = useState<PerfilMascarado | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function search() {
    setError('');
    if (name.trim().length < 3) { setError('Digite pelo menos 3 letras do seu nome.'); return; }
    setLoading(true);
    try {
      setMatches(await clienteRepository.searchByName(name));
      setSearched(true);
    } catch {
      setError('A busca está indisponível agora. Tente novamente.');
    } finally { setLoading(false); }
  }

  async function continueWithProfile() {
    setError('');
    if (phone.replace(/\D/g, '').length < 10) { setError('Informe o telefone com DDD.'); return; }
    setLoading(true);
    try {
      const session = await clienteRepository.createOrResumeSession({
        nome: selected?.nome ?? name.trim(),
        telefone: phone,
        ...(selected ? { clienteId: selected.clienteId } : {}),
      });
      salvarSessaoCliente(session);
      onAuthenticated(session);
    } catch {
      setError(PROFILE_CONFIRMATION_ERROR);
    } finally { setLoading(false); }
  }

  return (
    <div className="identity-form">
      {!searched && <div className="form-stack">
        <p className="muted-copy">Encontre seu perfil pelo nome. Se ainda não tiver um, vamos criar com nome e telefone.</p>
        <label className="field-label">Seu nome<Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" /></label>
        <Button block disabled={loading} onClick={search}><UserRound size={17} /> {loading ? 'Procurando…' : 'Procurar perfil'}</Button>
      </div>}
      {searched && <div className="form-stack">
        {matches.length ? <>
          <p className="muted-copy">Selecione seu perfil. O telefone fica mascarado nesta lista.</p>
          <div className="profile-options">{matches.map((profile) => <button className={`profile-option${selected?.clienteId === profile.clienteId ? ' is-selected' : ''}`} type="button" key={profile.clienteId} aria-pressed={selected?.clienteId === profile.clienteId} onClick={() => setSelected(profile)}><span><strong>{profile.nome}</strong><small>{profile.telefoneMascarado}</small></span>{selected?.clienteId === profile.clienteId && <Check size={18} />}</button>)}</div>
        </> : <div className="notice-card"><span className="notice-card__mark">+</span><div><strong>Perfil ainda não encontrado</strong><p>Vamos criar seu acesso com esse nome e telefone.</p></div></div>}
        <label className="field-label">Telefone com DDD<Input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(17) 99999-0000" /></label>
        <div className="button-row"><Button variant="ghost" onClick={() => { setSearched(false); setSelected(null); setError(''); }}><ArrowLeft size={16} /> Voltar</Button><Button disabled={loading || (matches.length > 0 && !selected)} onClick={continueWithProfile}>{loading ? 'Confirmando…' : 'Continuar'} <ArrowRight size={16} /></Button></div>
        <p className="privacy-note">O telefone completo só é usado para validar seu próprio perfil.</p>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
