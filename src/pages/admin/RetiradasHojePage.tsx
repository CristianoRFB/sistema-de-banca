import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Clock3, LoaderCircle } from 'lucide-react';
import { useAdminAuth } from '../../app/providers';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { adminRepository, type ReservaAdmin } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

export function RetiradasHojePage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [items, setItems] = useState<ReservaAdmin[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const load = useCallback(async () => {
    if (!user) return;
    try { setItems(await adminRepository.reservations(user, { date })); setFailed(false); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, [user, date]);
  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function confirmPickup(reservation: ReservaAdmin) {
    if (!user) return;
    const withdrawalItems = reservation.itens.map((item) => ({
      itemReservationId: item.itemReservaId,
      quantity: Number(quantities[item.itemReservaId] ?? ''),
    })).filter((item) => item.quantity > 0);
    if (!withdrawalItems.length) { toast('Informe a quantidade retirada fisicamente em pelo menos um item.', 'info'); return; }
    setSaving(reservation.id);
    try { await adminRepository.withdraw(user, reservation.id, withdrawalItems); toast('Retirada registrada no histórico.'); await load(); }
    catch { toast('Não foi possível confirmar. Confira o saldo e tente novamente.', 'info'); }
    finally { setSaving(null); }
  }

  return <div className="admin-page">
    <AdminHeading kicker="05 · OPERAÇÃO / BALCÃO" title="Retiradas de hoje." description="Confira as intenções e registre apenas as unidades que saíram de fato." />
    {loading ? <AdminLoading /> : failed ? <AdminLoadError onRetry={() => void load()} /> : items.length ? <div className="pickup-list">{items.map((reservation) => <article className="pickup-card" key={reservation.id}><div className="pickup-card__top"><span className="eyebrow">{reservation.horarioAproximado ? `APROX. ${reservation.horarioAproximado}` : 'SEM HORÁRIO MARCADO'}</span><span className={`pickup-intent pickup-intent--${reservation.intencaoRetirada.toLowerCase()}`}>{reservation.intencaoRetirada.replaceAll('_', ' ')}</span></div><h2>{reservation.clienteNome}</h2><div className="pickup-items">{reservation.itens.map((item) => { const remaining = item.quantidade - item.quantidadeRetirada; return <label className="pickup-item" key={item.itemReservaId}><span><strong>{item.titulo}</strong><small>{item.volume ? `Vol. ${item.volume} · ` : ''}{remaining} a retirar</small></span><input aria-label={`Unidades retiradas de ${item.titulo}`} type="number" inputMode="numeric" min={0} max={remaining} step={1} placeholder="0" value={quantities[item.itemReservaId] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [item.itemReservaId]: event.target.value === '' ? '' : String(Math.min(remaining, Math.max(0, Number(event.target.value)))) }))} /></label>; })}</div><div className="pickup-card__footer"><span><Clock3 size={15} /> Informe apenas unidades que saíram fisicamente.</span><Button disabled={saving === reservation.id} onClick={() => void confirmPickup(reservation)}>{saving === reservation.id ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />} Confirmar retirada</Button></div></article>)}</div> : <AdminEmpty title="A agenda de hoje está livre" detail="As reservas para retirada de hoje aparecem aqui com a intenção enviada pelo cliente." />}
    <p className="admin-help-note"><ArrowRight size={15} /> “Vou buscar” e “Estou indo” são apenas intenções. A baixa de estoque só acontece ao confirmar a retirada física.</p>
  </div>;
}
