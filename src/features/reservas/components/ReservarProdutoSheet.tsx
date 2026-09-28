import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useToast } from '../../../components/ui/Toast';
import { clienteRepository } from '../../cliente/cliente.repository';
import type { PerfilMascarado, SessaoCliente } from '../../cliente/cliente.types';
import { lerSessaoCliente, salvarSessaoCliente } from '../../../infra/local-storage/cliente-session';
import type { ProdutoCatalogo } from '../../catalogo/catalogo.types';
import { reservaRepository } from '../reserva.repository';
import { obterPerfilPublicoBanca } from '../../banca/banca.service';
import { validarDataRetirada } from '../../../domain/rules/validarDataRetirada';
import type { HorarioFuncionamento } from '../../../domain/entities/HorarioFuncionamento';

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function humanDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ReservarProdutoSheet({ produto, open, onClose }: { produto: ProdutoCatalogo; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState<SessaoCliente | null>(() => lerSessaoCliente());
  const [step, setStep] = useState<'name' | 'confirm' | 'reservation' | 'saving'>(() => lerSessaoCliente() ? 'reservation' : 'name');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [matches, setMatches] = useState<PerfilMascarado[]>([]);
  const [lookupDone, setLookupDone] = useState(false);
  const [selected, setSelected] = useState<PerfilMascarado | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  const [hours, setHours] = useState<HorarioFuncionamento[]>([]);
  const [hoursFailed, setHoursFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    obterPerfilPublicoBanca().then((profile) => {
      if (active) { setHours(profile.horarios); setHoursFailed(false); }
    }).catch(() => {
      if (active) { setHours([]); setHoursFailed(true); }
    });
    return () => { active = false; };
  }, [open]);

  const hoursLoading = open && hours.length !== 7 && !hoursFailed;

  const maxDate = useMemo(() => {
    const absoluteLimit = addDays(new Date(), 9);
    const batchLimit = produto.dataFimReservas ? new Date(produto.dataFimReservas) : null;
    return batchLimit && batchLimit.getTime() < absoluteLimit.getTime() ? localDate(batchLimit) : localDate(absoluteLimit);
  }, [produto.dataFimReservas]);

  const dates = useMemo(() => [1, 3, 7].map((offset) => ({ offset, day: addDays(new Date(), offset) }))
    .filter(({ day }) => localDate(day) <= maxDate)
    .filter(({ day }) => hours.some((hour) => hour.diaSemana === day.getDay() && !hour.fechado)), [hours, maxDate]);

  const selectedDayHours = date ? hours.find((hour) => hour.diaSemana === new Date(`${date}T12:00:00`).getDay()) : undefined;

  async function searchProfiles() {
    setError('');
    if (name.trim().length < 3) { setError('Digite seu nome completo para procurar.'); return; }
    try {
      const result = await clienteRepository.searchByName(name);
      setMatches(result);
      setLookupDone(true);
      setStep(result.length ? 'confirm' : 'confirm');
    } catch {
      setError('Não foi possível procurar agora. Confira sua conexão e tente novamente.');
    }
  }

  async function confirmIdentity() {
    setError('');
    if (phone.replace(/\D/g, '').length < 10) { setError('Confira o telefone com DDD.'); return; }
    try {
      const next = await clienteRepository.createOrResumeSession({
        nome: selected?.nome ?? name.trim(),
        telefone: phone,
        ...(selected ? { clienteId: selected.clienteId } : {}),
      });
      setSession(next);
      salvarSessaoCliente(next);
      setStep('reservation');
    } catch {
      setError('Não conseguimos validar esse telefone. Confira os números e tente novamente.');
    }
  }

  async function confirmReservation() {
    if (!session) { setStep('name'); return; }
    if (!date) { setError('Escolha uma data para retirar.'); return; }
    if (produto.demonstracao || !produto.permiteReserva || !produto.itemReparteId) {
      setError('Este título ainda não está disponível para reserva.');
      return;
    }
    if (hoursFailed || hoursLoading || hours.length !== 7) {
      setError('Não foi possível confirmar os horários da banca. Tente novamente em instantes.');
      return;
    }
    const now = new Date();
    const selectedDate = new Date(`${date}T00:00:00`);
    const validation = validarDataRetirada({
      agora: now,
      criadaEm: now,
      dataRetiradaPretendida: selectedDate,
      horarioAproximado: time || null,
      horarios: hours,
      dataFimReservas: produto.dataFimReservas ? new Date(produto.dataFimReservas) : null,
      dataRecolhimento: produto.dataRecolhimentoPrevista ? new Date(produto.dataRecolhimentoPrevista) : null,
    });
    if (!validation.ok) {
      setError(validation.issues[0]?.message ?? 'Escolha uma data e um horário válidos.');
      return;
    }
    setStep('saving');
    setError('');
    try {
      await reservaRepository.create(session.token, {
        itens: [{ itemReparteId: produto.itemReparteId, quantidade: 1 }],
        dataRetiradaPretendida: date,
        ...(time ? { horarioAproximado: time } : {}),
      });
      toast('Reserva criada. Você pode acompanhar o prazo em Minhas reservas.');
      onClose();
      navigate('/cliente/reservas');
    } catch (cause) {
      setStep('reservation');
      setError(cause instanceof Error ? cause.message : 'A reserva não foi confirmada. A disponibilidade pode ter mudado; atualize o catálogo e tente de novo.');
    }
  }

  const stepTitle = step === 'name' ? 'Vamos nos conhecer' : step === 'confirm' ? 'Confirme seu perfil' : 'Quando você vem?';

  return (
    <BottomSheet open={open} title={stepTitle} onClose={onClose}>
      <div className="reserve-sheet">
        <div className="reserve-product-mini"><span className="reserve-product-mini__mark">読</span><div><strong>{produto.titulo}</strong><span>{produto.volume ? `Volume ${produto.volume}` : 'Banca Ana Maria'}</span></div></div>
        {step === 'name' && <div className="form-stack">
          <p className="muted-copy">A reserva fica vinculada ao seu nome e telefone. Busque seu perfil para continuar ou crie um novo.</p>
          <label className="field-label">Seu nome<Input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome e sobrenome" /></label>
          <Button block onClick={searchProfiles}><UserRound size={17} /> Procurar meu perfil</Button>
          <p className="privacy-note">Seu telefone nunca aparece por inteiro na busca.</p>
        </div>}
        {step === 'confirm' && <div className="form-stack">
          {lookupDone && matches.length > 0 ? <>
            <p className="muted-copy">Escolha seu perfil. O telefone aparece mascarado para sua privacidade.</p>
            <div className="profile-options">{matches.map((profile) => <button className={`profile-option${selected?.clienteId === profile.clienteId ? ' is-selected' : ''}`} type="button" key={profile.clienteId} onClick={() => { setSelected(profile); setName(profile.nome); }}><span><strong>{profile.nome}</strong><small>{profile.telefoneMascarado}</small></span>{selected?.clienteId === profile.clienteId && <Check size={18} />}</button>)}</div>
          </> : <div className="notice-card"><span className="notice-card__mark">+</span><div><strong>Nenhum perfil encontrado</strong><p>Vamos criar seu perfil com nome e telefone.</p></div></div>}
          <label className="field-label">Telefone com DDD<Input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(17) 99999-0000" /></label>
          <div className="button-row"><Button variant="ghost" onClick={() => { setStep('name'); setError(''); }}><ArrowLeft size={16} /> Voltar</Button><Button onClick={confirmIdentity}>Continuar <ArrowRight size={16} /></Button></div>
        </div>}
        {(step === 'reservation' || step === 'saving') && <div className="form-stack">
          <p className="muted-copy">Olá, {session?.nome}. Escolha uma data. O prazo de retirada respeita o funcionamento da banca e o lote.</p>
          {hoursLoading && <div className="loading-block" aria-live="polite">Consultando os horários da banca…</div>}
          {hoursFailed && <p className="form-error" role="alert">Não foi possível consultar os horários. Reabra a reserva para tentar novamente.</p>}
          <div className="date-shortcuts" role="group" aria-label="Datas rápidas para retirada">{dates.length ? dates.map(({ day, offset }) => {
            const dateValue = localDate(day);
            const label = offset === 1 ? 'Amanhã' : `Em ${offset} dias`;
            return <button key={dateValue} className={`date-shortcut${date === dateValue ? ' is-selected' : ''}`} type="button" onClick={() => setDate(dateValue)}><span>{label}</span><strong>{day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</strong><small>{day.toLocaleDateString('pt-BR', { weekday: 'short' })}</small></button>;
          }) : <div className="notice-card"><CalendarDays size={18} /><div><strong>Sem datas seguras disponíveis</strong><p>Este lote está perto do recolhimento. Fale com a banca.</p></div></div>}</div>
          <label className="field-label">Outra data <span className="field-optional">opcional</span><div className="field-with-icon"><CalendarDays size={17} /><Input type="date" value={date} min={localDate(addDays(new Date(), 1))} max={maxDate} onChange={(event) => setDate(event.target.value)} /></div></label>
          {date && <p className="selected-date"><Check size={15} /> Retirada pretendida para {humanDate(date)}.</p>}
          <label className="field-label">Horário aproximado <span className="field-optional">opcional</span><div className="field-with-icon"><Clock3 size={17} /><Input type="time" min={selectedDayHours?.abre ?? undefined} max={selectedDayHours?.fecha ?? undefined} disabled={!date || !selectedDayHours || selectedDayHours.fechado} value={time} onChange={(event) => setTime(event.target.value)} /></div></label>
          <Button block disabled={step === 'saving' || !date || hoursLoading || hoursFailed || hours.length !== 7} onClick={confirmReservation}>{step === 'saving' ? 'Confirmando…' : 'Confirmar reserva'} <ArrowRight size={17} /></Button>
          <p className="privacy-note">A equipe da banca confirma a retirada presencialmente.</p>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </BottomSheet>
  );
}
