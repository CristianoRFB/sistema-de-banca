import { apiRequest } from '../../infra/browser/api-client';

export interface HorarioPublicoBanca {
  diaSemana: number;
  fechado: boolean;
  abre: string | null;
  fecha: string | null;
}

export interface PerfilPublicoBanca {
  nomeExibicao: string;
  slug: string;
  telefone: string;
  endereco: string;
  fotoUrl: string | null;
  horarios: HorarioPublicoBanca[];
}

export const bancaRepository = {
  async getPublic(): Promise<PerfilPublicoBanca> {
    const result = await apiRequest<{
      profile: { name: string; slug: string; phone: string; address: string; photoUrl: string | null };
      hours: Array<{ dayOfWeek: number; closed: boolean; opensAt: string | null; closesAt: string | null }>;
    }>('/public/banca');
    return {
      nomeExibicao: result.profile.name,
      slug: result.profile.slug,
      telefone: result.profile.phone,
      endereco: result.profile.address,
      fotoUrl: result.profile.photoUrl,
      horarios: result.hours.map((hour) => ({ diaSemana: hour.dayOfWeek, fechado: hour.closed, abre: hour.opensAt, fecha: hour.closesAt })),
    };
  },
};
