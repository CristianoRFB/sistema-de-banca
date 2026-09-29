import { apiRequest, jsonBody } from '../../infra/browser/api-client';
import type { PerfilCliente, PerfilMascarado, SessaoCliente } from './cliente.types';

function sessionHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export const clienteRepository = {
  async searchByName(nome: string): Promise<PerfilMascarado[]> {
    const params = new URLSearchParams({ name: nome.trim() });
    const result = await apiRequest<{ profiles: Array<{ id: string; name: string; maskedPhone: string }>; hasMore: boolean }>(`/public/profile?${params}`);
    return result.profiles.map((profile) => ({ clienteId: profile.id, nome: profile.name, telefoneMascarado: profile.maskedPhone }));
  },

  async createOrResumeSession(input: { nome: string; telefone: string; clienteId?: string }): Promise<SessaoCliente> {
    const result = await apiRequest<{ sessionToken: string; expiresAt: string; profile: { id: string; name: string } }>('/client/sessions', jsonBody({ name: input.nome, phone: input.telefone }));
    return { token: result.sessionToken, clienteId: result.profile.id, nome: result.profile.name };
  },

  async logout(token: string): Promise<void> {
    await apiRequest<{ revoked: boolean }>('/client/sessions/logout', {
      ...jsonBody({}),
      headers: sessionHeaders(token),
    });
  },

  async getMyProfile(token: string): Promise<PerfilCliente> {
    const result = await apiRequest<{ profile: { clientId: string; name: string } }>('/client/profile', { headers: sessionHeaders(token) });
    return { clienteId: result.profile.clientId, nome: result.profile.name };
  },

  async updateMyProfile(token: string, input: { nome: string; telefone: string }): Promise<PerfilCliente> {
    const result = await apiRequest<{ profile: { clientId: string; name: string } }>('/client/profile', {
      ...jsonBody({ name: input.nome, phone: input.telefone }),
      method: 'PATCH',
      headers: { ...sessionHeaders(token), 'Idempotency-Key': crypto.randomUUID() },
    });
    return { clienteId: result.profile.clientId, nome: result.profile.name };
  },
};
