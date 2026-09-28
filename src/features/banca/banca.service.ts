import { bancaRepository, type PerfilPublicoBanca } from './banca.repository';

export async function obterPerfilPublicoBanca(): Promise<PerfilPublicoBanca> {
  return bancaRepository.getPublic();
}
