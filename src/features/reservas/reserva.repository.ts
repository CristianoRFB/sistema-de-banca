import { apiRequest, jsonBody } from '../../infra/browser/api-client';
import type { ReservaCliente } from '../cliente/cliente.types';

const headers = (token: string): HeadersInit => ({ Authorization: `Bearer ${token}` });
const idempotentHeaders = (token: string): HeadersInit => ({ ...headers(token), 'Idempotency-Key': crypto.randomUUID() });

interface ReservationApi {
  id: string;
  status: ReservaCliente['status'];
  createdAt: string;
  desiredDate: string;
  desiredTime?: string | null;
  expiresAt: string;
  pickupIntent: ReservaCliente['intencaoRetirada'];
  items: Array<{ id: string; itemReparteId: string; title: string; volume?: string | null; quantity: number; quantityWithdrawn: number }>;
}

function mapReservation(reservation: ReservationApi): ReservaCliente {
  return {
    id: reservation.id,
    status: reservation.status,
    criadaEm: reservation.createdAt,
    dataRetiradaPretendida: reservation.desiredDate,
    horarioAproximado: reservation.desiredTime ?? null,
    expiraEm: reservation.expiresAt,
    intencaoRetirada: reservation.pickupIntent,
    itens: reservation.items.map((item) => ({
      itemReservaId: item.id,
      itemReparteId: item.itemReparteId,
      titulo: item.title,
      volume: item.volume ?? null,
      quantidade: item.quantity,
      quantidadeRetirada: item.quantityWithdrawn,
    })),
  };
}

export const reservaRepository = {
  async listMine(token: string): Promise<ReservaCliente[]> {
    return (await reservaRepository.listMinePage(token)).reservations;
  },

  async listMinePage(token: string, cursor?: string | null): Promise<{ reservations: ReservaCliente[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const response = await apiRequest<{ reservations: ReservationApi[]; page?: { nextCursor?: string | null } }>(`/client/reservations${params.size ? `?${params}` : ''}`, { headers: headers(token) });
    return { reservations: response.reservations.map(mapReservation), nextCursor: response.page?.nextCursor ?? null };
  },

  async getMine(token: string, id: string): Promise<ReservaCliente> {
    const response = await apiRequest<ReservationApi>(`/client/reservations/${encodeURIComponent(id)}`, { headers: headers(token) });
    return mapReservation(response);
  },

  async create(token: string, input: { itens: Array<{ itemReparteId: string; quantidade: number }>; dataRetiradaPretendida: string; horarioAproximado?: string }): Promise<ReservaCliente> {
    const result = await apiRequest<ReservationApi>('/client/reservations', { ...jsonBody({
      items: input.itens.map((item) => ({ itemReparteId: item.itemReparteId, quantity: item.quantidade })),
      desiredDate: input.dataRetiradaPretendida,
      ...(input.horarioAproximado ? { desiredTime: input.horarioAproximado } : {}),
    }), headers: idempotentHeaders(token) });
    return mapReservation(result);
  },

  cancel(token: string, reservaId: string): Promise<void> {
    return apiRequest<void>(`/client/reservations/${encodeURIComponent(reservaId)}/cancel`, { ...jsonBody({}), headers: idempotentHeaders(token) });
  },

  async setIntent(token: string, reservaId: string, intencao: 'VOU_BUSCAR' | 'ESTOU_INDO' | 'NAO_VOU'): Promise<ReservaCliente> {
    const result = await apiRequest<ReservationApi>(`/client/reservations/${encodeURIComponent(reservaId)}/intent`, {
      method: 'PATCH',
      headers: { ...idempotentHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: intencao }),
    });
    return mapReservation(result);
  },

  async reschedule(token: string, reservaId: string, desiredDate: string, desiredTime?: string): Promise<ReservaCliente> {
    const result = await apiRequest<ReservationApi>(`/client/reservations/${encodeURIComponent(reservaId)}/reschedule`, {
      method: 'PATCH',
      headers: { ...headers(token), 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ desiredDate, ...(desiredTime ? { desiredTime } : {}) }),
    });
    return mapReservation(result);
  },
};
