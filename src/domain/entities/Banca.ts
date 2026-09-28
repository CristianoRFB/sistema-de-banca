export interface EnderecoBanca {
  logradouro: string;
  complemento?: string | null;
  cidade: string;
  estado: string;
  cep?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface Banca {
  id: string;
  nomeExibicao: string;
  slug: string;
  telefone: string;
  endereco: EnderecoBanca | string | null;
  fotoFixaUrl: string | null;
  margemRecolhimentoDias: number;
  toleranciaRetiradaDias: number;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}