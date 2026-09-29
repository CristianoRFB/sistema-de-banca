import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, RotateCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminAuth } from '../../app/providers';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { adminRepository, type AdminNotification } from '../../features/admin/admin.repository';
import { AdminEmpty, AdminHeading, AdminLoadError, AdminLoading } from './AdminCommon';

function formatDate(value: string | null) {
  if (!value) return 'Data não informada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data não informada' : date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function NotificacoesAdminPage() {
  const { user } = useAdminAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  const load = useCallback(async (next: string | null = null) => {
    if (!user) return;
    if (next) { setLoadingMore(true); setMoreFailed(false); }
    else setLoading(true);
    try {
      const result = await adminRepository.notificationsPage(user, next);
      setNotifications((current) => next ? [...current, ...result.notifications] : result.notifications);
      setCursor(result.page?.nextCursor ?? null);
      setFailed(false);
    } catch {
      if (next) setMoreFailed(true);
      else setFailed(true);
    } finally {
      if (next) setLoadingMore(false);
      else setLoading(false);
    }
  }, [user]);

  // load() updates React only after its awaited API request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function markRead(item: AdminNotification) {
    if (!user || item.read || savingId) return;
    setSavingId(item.id);
    try {
      await adminRepository.markNotificationRead(user, item.id);
      setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
    } catch { toast('Não foi possível atualizar este aviso.', 'info'); }
    finally { setSavingId(null); }
  }

  return <div className="admin-page">
    <AdminHeading kicker="08 · AVISOS / EQUIPE" title="Avisos da banca." description="Lembretes operacionais enviados pelos processos automáticos aparecem aqui." />
    {loading ? <AdminLoading label="Carregando avisos…" /> : failed ? <AdminLoadError onRetry={() => { setLoading(true); setFailed(false); void load(); }} /> : notifications.length ? <>
      <div className="admin-notification-list">{notifications.map((item) => <article className={`admin-notification-card${item.read ? '' : ' is-unread'}`} key={item.id}>
        <span className="admin-notification-card__icon"><Bell size={18} /></span>
        <div className="admin-notification-card__body"><div className="admin-notification-card__meta"><Badge tone={item.read ? 'muted' : 'orange'}>{item.read ? 'Lido' : 'Novo'}</Badge><span className="eyebrow">{formatDate(item.createdAt)}</span></div><h2>{item.title}</h2><p>{item.message}</p><small>{item.type.replaceAll('_', ' ').toLocaleLowerCase('pt-BR')}</small></div>
        <div className="admin-notification-card__actions">{item.reservationId && <Link className="text-button" to="/admin/reservas">Abrir reservas</Link>}{!item.read && <Button variant="secondary" size="small" disabled={savingId !== null} onClick={() => void markRead(item)}>{savingId === item.id ? 'Salvando…' : <><Check size={15} /> Marcar como lido</>}</Button>}</div>
      </article>)}</div>
      {cursor && <div className="history-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void load(cursor)}>{loadingMore ? 'Carregando…' : moreFailed ? 'Tentar carregar novamente' : 'Carregar mais avisos'}</Button></div>}
    </> : <AdminEmpty title="Nenhum aviso por enquanto" detail="Quando um lembrete operacional for gerado, ele ficará disponível nesta caixa." />}
    <div className="admin-notification-refresh"><Button variant="secondary" disabled={loading} onClick={() => { setCursor(null); void load(); }}><RotateCw size={15} /> Atualizar avisos</Button></div>
  </div>;
}
