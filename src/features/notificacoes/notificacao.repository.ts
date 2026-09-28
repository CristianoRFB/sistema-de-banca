import { apiRequest } from '../../infra/browser/api-client';
import type { NotificacaoCliente } from './notificacao.types';

export const notificacaoRepository = {
  async listMine(token: string): Promise<NotificacaoCliente[]> {
    const result = await apiRequest<{ notifications: Array<{ id: string; titulo: string; mensagem: string; criadaEm: string; lida: boolean; tipo: string }> }>('/client/notifications', { headers: { Authorization: `Bearer ${token}` } });
    return result.notifications;
  },
};
