import { apiRequest, jsonBody } from '../../infra/browser/api-client';
import type { User } from 'firebase/auth';

export interface DashboardSummary {
  retiradasHoje: number;
  confirmaramPresenca: number;
  estaoACaminho: number;
  semResposta: number;
  recolhimentosProximos: number;
  listasRascunho: number;
  listasPublicadas: number;
}

export interface ListaAdmin {
  id: string;
  title: string;
  status: 'RASCUNHO' | 'PUBLICADA' | 'ENCERRADA' | 'ARQUIVADA';
  createdAt: string;
  publishedAt?: string | null;
  totalItems: number;
  reparteId?: string | null;
}

export interface ItemListaAdmin {
  id: string;
  title: string;
  volume?: string | null;
  price?: number | null;
  quantity?: number | null;
  code?: string | null;
  publisher?: string | null;
  originalTitle?: string | null;
  returnDate?: string | null;
  confidence?: number;
  issues?: string[];
  requiresReview?: boolean;
  type?: string;
  active?: boolean;
  itemReparteId?: string;
  productId?: string;
}

export interface ListaAdminCompleta { list: ListaAdmin; items: ItemListaAdmin[] }

export interface ReservaAdmin {
  id: string;
  clienteNome: string;
  clienteTelefoneMascarado: string;
  dataRetiradaPretendida: string;
  horarioAproximado?: string | null;
  status: string;
  intencaoRetirada: string;
  itens: Array<{ itemReservaId: string; itemReparteId: string; titulo: string; volume?: string | null; quantidade: number; quantidadeRetirada: number }>;
}

export interface ReparteAdmin {
  id: string;
  title: string;
  plannedCollectionAt?: string | null;
  reservationCutoffAt?: string | null;
  status: string;
  itemCount?: number;
}

export interface ListMutationResult { listId: string; reparteId: string; status: string; itemCount: number; version: number }

export interface DadosBancaAdmin {
  nomeExibicao: string;
  telefone: string;
  endereco: string;
  toleranciaRetiradaDias: number;
  margemRecolhimentoDias: number;
  horarios: Array<{ diaSemana: number; fechado: boolean; abre: string | null; fecha: string | null }>;
}

export interface ReconciliationItemAdmin {
  itemReparteId: string;
  productId: string;
  title: string;
  volume?: string | null;
  quantityExpected: number;
  quantityFound: number | null;
  quantityReturned: number | null;
  reserved: number;
  resolution?: string | null;
  status: string;
}

export interface ReconciliationAdmin {
  reparte: ReparteAdmin;
  collection: { id: string; status: string; plannedCollectionAt?: string | null } | null;
  items: ReconciliationItemAdmin[];
}

async function adminRequest<T>(user: User, path: string, init: RequestInit = {}) {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return apiRequest<T>(`/admin${path}`, { ...init, headers });
}

const key = () => crypto.randomUUID();

export const adminRepository = {
  dashboard: async (user: User): Promise<DashboardSummary> => {
    const raw = await adminRequest<{
      reservationsToday?: number;
      activeReservations?: number;
      reservations?: Array<{ pickupIntent?: string | null }>;
      upcomingRepartes?: unknown[];
      draftLists?: number | unknown[];
      publishedLists?: number | unknown[];
      recollectionsDueSoon?: number | unknown[];
    }>(user, '/dashboard');
    const todayReservations = raw.reservations ?? [];
    const count = (value: number | unknown[] | undefined) => typeof value === 'number' ? value : value?.length ?? 0;
    return {
      retiradasHoje: raw.reservationsToday ?? todayReservations.length,
      confirmaramPresenca: todayReservations.filter((item) => item.pickupIntent === 'VOU_BUSCAR').length,
      estaoACaminho: todayReservations.filter((item) => item.pickupIntent === 'ESTOU_INDO').length,
      semResposta: todayReservations.filter((item) => !item.pickupIntent || item.pickupIntent === 'PENDENTE' || item.pickupIntent === 'SEM_RESPOSTA').length,
      recolhimentosProximos: count(raw.recollectionsDueSoon) || count(raw.upcomingRepartes),
      listasRascunho: count(raw.draftLists),
      listasPublicadas: count(raw.publishedLists),
    };
  },
  lists: async (user: User, status?: string) => (await adminRequest<{ lists: ListaAdmin[] }>(user, `/lists${status ? `?status=${encodeURIComponent(status)}` : ''}`)).lists,
  getList: (user: User, id: string) => adminRequest<ListaAdminCompleta>(user, `/lists/${encodeURIComponent(id)}`),
  createList: (user: User, input: unknown) => adminRequest<ListMutationResult>(user, '/lists', { ...jsonBody(input), headers: { 'Idempotency-Key': key() } }),
  updateList: (user: User, id: string, input: unknown) => adminRequest<ListMutationResult>(user, `/lists/${encodeURIComponent(id)}`, { ...jsonBody(input), method: 'PUT', headers: { 'Idempotency-Key': key() } }),
  publishList: (user: User, id: string) => adminRequest<ListMutationResult>(user, `/lists/${encodeURIComponent(id)}/publish`, { ...jsonBody({}), headers: { 'Idempotency-Key': key() } }),
  reservations: async (user: User, filters: { status?: string; date?: string } = {}) => {
    const query = new URLSearchParams({ limit: '50', ...filters });
    const response = await adminRequest<{ reservations: Array<Record<string, unknown>> }>(user, `/reservations?${query}`);
    return response.reservations.map((raw): ReservaAdmin => {
      const customer = typeof raw.customer === 'object' && raw.customer !== null ? raw.customer as Record<string, unknown> : {};
      const items = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
      return {
        id: String(raw.id ?? ''),
        clienteNome: String(customer.name ?? raw.customerName ?? ''),
        clienteTelefoneMascarado: String(customer.maskedPhone ?? raw.maskedPhone ?? ''),
        dataRetiradaPretendida: String(raw.desiredDate ?? ''),
        horarioAproximado: typeof raw.desiredTime === 'string' ? raw.desiredTime : null,
        status: String(raw.status ?? ''),
        intencaoRetirada: String(raw.pickupIntent ?? 'SEM_RESPOSTA'),
        itens: items.map((item) => ({
          itemReservaId: String(item.id ?? item.itemReservationId ?? ''),
          itemReparteId: String(item.itemReparteId ?? ''),
          titulo: String(item.title ?? ''),
          volume: typeof item.volume === 'string' ? item.volume : null,
          quantidade: Number(item.quantity ?? 0),
          quantidadeRetirada: Number(item.quantityWithdrawn ?? 0),
        })),
      };
    });
  },
  withdraw: (user: User, id: string, items: Array<{ itemReservationId: string; quantity: number }>) => adminRequest<ReservaAdmin>(user, `/reservations/${encodeURIComponent(id)}/withdraw`, {
    ...jsonBody({ items }), headers: { 'Idempotency-Key': key() },
  }),
  repartes: (user: User, status?: string) => adminRequest<{ repartes: ReparteAdmin[] }>(user, `/repartes${status ? `?status=${encodeURIComponent(status)}` : ''}`).then((result) => result.repartes),
  reconciliation: (user: User, id: string) => adminRequest<ReconciliationAdmin>(user, `/repartes/${encodeURIComponent(id)}/reconciliation`),
  reconcile: (user: User, id: string, items: Array<{ itemReparteId: string; quantityFound: number; resolution?: string; reason?: string }>) => adminRequest<ReconciliationAdmin>(user, `/repartes/${encodeURIComponent(id)}/reconcile`, {
    ...jsonBody({ items }), headers: { 'Idempotency-Key': key() },
  }),
  history: async (user: User, type: 'sales' | 'returns' | 'changes') => (await adminRequest<{ entries: unknown[] }>(user, `/histories?type=${type}&limit=50`)).entries,
  getBanca: async (user: User): Promise<DadosBancaAdmin> => {
    const result = await adminRequest<{ profile: { name: string; phone: string; address: string; withdrawalToleranceDays: number; collectionSafetyMarginDays: number }; hours: Array<{ dayOfWeek: number; closed: boolean; opensAt: string | null; closesAt: string | null }> }>(user, '/banca');
    return {
      nomeExibicao: result.profile.name,
      telefone: result.profile.phone,
      endereco: result.profile.address,
      toleranciaRetiradaDias: result.profile.withdrawalToleranceDays,
      margemRecolhimentoDias: result.profile.collectionSafetyMarginDays,
      horarios: result.hours.map((hour) => ({ diaSemana: hour.dayOfWeek, fechado: hour.closed, abre: hour.opensAt, fecha: hour.closesAt })),
    };
  },
  updateBanca: async (user: User, data: Partial<DadosBancaAdmin>): Promise<DadosBancaAdmin> => {
    const result = await adminRequest<{ profile: { name: string; phone: string; address: string; withdrawalToleranceDays: number; collectionSafetyMarginDays: number }; hours: Array<{ dayOfWeek: number; closed: boolean; opensAt: string | null; closesAt: string | null }> }>(user, '/banca', { method: 'PUT', ...jsonBody({
      profile: {
        name: data.nomeExibicao,
        phone: data.telefone,
        address: data.endereco,
        withdrawalToleranceDays: data.toleranciaRetiradaDias,
        collectionSafetyMarginDays: data.margemRecolhimentoDias,
      },
      hours: data.horarios?.map((hour) => ({ dayOfWeek: hour.diaSemana, closed: hour.fechado, opensAt: hour.abre, closesAt: hour.fecha })),
    }) });
    return {
      nomeExibicao: result.profile.name,
      telefone: result.profile.phone,
      endereco: result.profile.address,
      toleranciaRetiradaDias: result.profile.withdrawalToleranceDays,
      margemRecolhimentoDias: result.profile.collectionSafetyMarginDays,
      horarios: result.hours.map((hour) => ({ diaSemana: hour.dayOfWeek, fechado: hour.closed, abre: hour.opensAt, fecha: hour.closesAt })),
    };
  },
};
