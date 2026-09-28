import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3 } from 'lucide-react';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { obterPerfilPublicoBanca } from '../../banca/banca.service';
import type { HorarioFuncionamento } from '../../../domain/entities/HorarioFuncionamento';
import { validarDataRetirada } from '../../../domain/rules/validarDataRetirada';
import type { ReservaCliente } from '../../cliente/cliente.types';
import { reservaRepository } from '../reserva.repository';

function addDays(value: Date, days: number) { const result = new Date(value); result.setDate(result.getDate() + days); return result; }
function localDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }

export function ReagendarReservaSheet({
  token, reservation, open, onClose, onSaved,
}: {
  token: string;
  reservation: ReservaCliente;
  open: boolean;
  onClose: () => void;
  onSaved: (reservation: ReservaCliente) => void;
}) {
  const [date, setDate] = useState(reservation.dataRetiradaPretendida.slice(0, 10));
  const [time, setTime] = useState(reservation.horarioAproximado ?? '');
  const [hours, setHours] = useState<HorarioFuncionamento[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    obterPerfilPublicoBanca().then((profile) => { if (active) setHours(profile.horarios); })
      .catch(() => { if (active) setError('Não foi possível consultar os horários da banca. Tente novamente.'); });
    return () => { active = false; };
  }, [open]);

  const loadingHours = open && hours.length !== 7 && !error;

  const maxDate = useMemo(() => localDate(addDays(new Date(), 9)), []);
  const suggestions = useMemo(() => [1, 3, 7].map((offset) => ({ offset, day: addDays(new Date(), offset) }))
    .filter(({ day }) => localDate(day) <= maxDate)
    .filter(({ day }) => hours.some((hour) => hour.diaSemana === day.getDay() && !hour.fechado)), [hours, maxDate]);
  const selectedHours = date ? hours.find((hour) => hour.diaSemana === new Date(`${date}T12:00:00`).getDay()) : undefined;

  async function save() {
    setError('');
    if (!date) { setError('Escolha uma data de retirada.'); return; }
    if (hours.length !== 7 || loadingHours) { setError('Aguarde a confirmação dos horários da banca.'); return; }
    const now = new Date();
    const result = validarDataRetirada({
      agora: now,
      criadaEm: now,
      dataRetiradaPretendida: new Date(`${date}T00:00:00`),
      horarioAproximado: time || null,
      horarios: hours,
    });
    if (!result.ok) { setError(result.issues[0]?.message ?? 'Escolha um horário válido.'); return; }
    setSaving(true);
    try {
      const updated = await reservaRepository.reschedule(token, reservation.id, date, time || undefined);
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reagendar esta reserva.');
    } finally { setSaving(false); }
  }

  return <BottomSheet open={open} title="Alterar data de retirada" onClose={onClose}>
    <div className="form-stack reschedule-form">
      <p className="muted-copy">Escolha uma nova data dentro do funcionamento da banca. O prazo e os avisos serão recalculados.</p>
      <div className="date-shortcuts" role="group" aria-label="Sugestões de data">{suggestions.map(({ day, offset }) => {
        const value = localDate(day);
        return <button key={value} className={`date-shortcut${date === value ? ' is-selected' : ''}`} type="button" onClick={() => setDate(value)}><span>{offset === 1 ? 'Amanhã' : `Em ${offset} dias`}</span><strong>{day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</strong><small>{day.toLocaleDateString('pt-BR', { weekday: 'short' })}</small></button>;
      })}</div>
      <label className="field-label">Nova data<div className="field-with-icon"><CalendarDays size={17} /><Input type="date" value={date} min={localDate(new Date())} max={maxDate} onChange={(event) => setDate(event.target.value)} /></div></label>
      {date && <p className="selected-date"><Check size={15} /> Nova retirada em {new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>}
      <label className="field-label">Horário aproximado <span className="field-optional">opcional</span><div className="field-with-icon"><Clock3 size={17} /><Input type="time" min={selectedHours?.abre ?? undefined} max={selectedHours?.fecha ?? undefined} disabled={!date || !selectedHours || selectedHours.fechado} value={time} onChange={(event) => setTime(event.target.value)} /></div></label>
      {loadingHours && <div className="loading-block">Consultando horários…</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button block disabled={saving || loadingHours || hours.length !== 7 || !date} onClick={() => void save()}>{saving ? 'Reagendando…' : 'Confirmar nova data'}</Button>
    </div>
  </BottomSheet>;
}
