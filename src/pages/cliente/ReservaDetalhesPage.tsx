import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, Clock3, PackageCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { ReservaCliente } from '../../features/cliente/cliente.types';
import { lerSessaoCliente } from '../../infra/local-storage/cliente-session';
import { reservaRepository } from '../../features/reservas/reserva.repository';
import { BuscarPerfil } from '../../features/cliente/components/BuscarPerfil';
import { useToast } from '../../components/ui/Toast';
import { ReagendarReservaSheet } from '../../features/reservas/components/ReagendarReservaSheet';

export function ReservaDetalhesPage() {
  const { reservaId } = useParams();
  const [session, setSession] = useState(() => lerSessaoCliente());
  const [reservation, setReservation] = useState<ReservaCliente | null>(null);
  const [loading, setLoading] = useState(() => !!lerSessaoCliente());
  const [error, setError] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!session || !reservaId) return;
    try { setReservation(await reservaRepository.getMine(session.token, reservaId)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [session, reservaId]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function intent(value: 'VOU_BUSCAR' | 'ESTOU_INDO') {
    if (!session || !reservation) return;
    try { setReservation(await reservaRepository.setIntent(session.token, reservation.id, value)); toast('A banca foi avisada.'); }
    catch { toast('Não foi possível atualizar agora.', 'info'); }
  }

  async function cancel() {
    if (!session || !reservation) return;
    try { await reservaRepository.cancel(session.token, reservation.id); toast('Reserva cancelada.'); await load(); }
    catch { toast('Não foi possível cancelar agora.', 'info'); }
  }

  return (
    <div className="customer-page page-wrap">
      <Link className="back-link" to="/cliente/reservas"><ArrowLeft size={17} /> Minhas reservas</Link>
      {!session ? <section className="identity-panel"><div className="identity-panel__intro"><span className="identity-icon"><PackageCheck size={20} /></span><div><h2>Acesse sua reserva</h2><p>Confirme nome e telefone para continuar.</p></div></div><BuscarPerfil onAuthenticated={(next) => { setLoading(true); setSession(next); }} /></section>
        : loading ? <div className="loading-block">Abrindo a reserva…</div>
          : error ? <div className="empty-state"><h2>Não conseguimos abrir essa reserva.</h2><Button variant="secondary" onClick={() => void load()}>Tentar de novo</Button></div>
            : !reservation ? <div className="empty-state"><span className="eyebrow">RESERVA NÃO ENCONTRADA</span><h2>Esse registro não está na sua lista.</h2><Link className="button button--dark" to="/cliente/reservas">Voltar às reservas</Link></div>
              : <article className="reservation-detail-card"><div className="reservation-card__top"><span className="eyebrow">RESERVA #{reservation.id.slice(0, 8).toUpperCase()}</span><Badge tone={reservation.status === 'ATIVA' ? 'lime' : 'muted'}>{reservation.status.replaceAll('_', ' ')}</Badge></div><h1>Uma história<br /><em>reservada para você.</em></h1><div className="reservation-items">{reservation.itens.map((item) => <div key={item.itemReservaId}><span className="reservation-item__mark">読</span><span><strong>{item.titulo}</strong><small>{item.volume ? `Volume ${item.volume} · ` : ''}{item.quantidade} un.</small></span><b>{item.quantidadeRetirada ? `${item.quantidadeRetirada} retirada(s)` : ''}</b></div>)}</div><div className="reservation-detail-row"><span><CalendarDays size={17} /> Retirada pretendida</span><b>{new Date(`${reservation.dataRetiradaPretendida.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</b></div><div className="reservation-detail-row"><span><Clock3 size={17} /> Expiração</span><b>{formatExpiry(reservation.expiraEm)}</b></div>{reservation.status === 'ATIVA' || reservation.status === 'PARCIALMENTE_RETIRADA' ? <div className="reservation-card__actions"><Button onClick={() => void intent('VOU_BUSCAR')}>Vou buscar</Button><Button variant="secondary" onClick={() => void intent('ESTOU_INDO')}>Estou indo</Button><Button variant="secondary" onClick={() => setRescheduleOpen(true)}>Alterar data</Button><button className="text-button" type="button" onClick={() => void cancel()}>Desistir da reserva</button></div> : <p className="privacy-note">Este registro permanece no seu histórico.</p>}</article>}
      {session && reservation && (reservation.status === 'ATIVA' || reservation.status === 'PARCIALMENTE_RETIRADA') && <ReagendarReservaSheet token={session.token} reservation={reservation} open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} onSaved={(updated) => { setReservation(updated); toast('Reserva reagendada. Os avisos foram atualizados.'); }} />}
    </div>
  );
}

function formatExpiry(value: string) {
  const date = new Date(value);
  const days = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
  if (days === 0) return `Hoje às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Amanhã';
  return `${days} dias restantes`;
}
