import { apiRequest, jsonBody } from '../../infra/browser/api-client';
import type { NotificacaoCliente } from './notificacao.types';

export const notificacaoRepository = {
  async listMine(token: string): Promise<NotificacaoCliente[]> {
    return (await notificacaoRepository.listMinePage(token)).notifications;
  },
  async listMinePage(token: string, cursor?: string | null): Promise<{ notifications: NotificacaoCliente[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    const result = await apiRequest<{ notifications: NotificacaoCliente[]; page?: { nextCursor?: string | null } }>(`/client/notifications${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    return { notifications: result.notifications, nextCursor: result.page?.nextCursor ?? null };
  },
  markMineRead(token: string, id: string): Promise<{ notificationId: string; read: boolean }> {
    return apiRequest<{ notificationId: string; read: boolean }>(`/client/notifications/${encodeURIComponent(id)}/read`, {
      ...jsonBody({}),
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};
