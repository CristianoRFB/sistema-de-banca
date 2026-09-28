/** Perfil privado de cliente: nome e telefone, sem e-mail, senha ou foto. */
export interface Cliente {
  id: string;
  bancaId: string;
  nome: string;
  nomeNormalizado: string;
  telefone: string;
  telefoneNormalizado: string;
  telefoneFinal: string;
  criadoEm: Date;
  atualizadoEm: Date;
  ativo: boolean;
}

/** Projeção permitida em busca pública; nunca contém o telefone completo. */
export interface ClientePublico {
  id: string;
  nome: string;
  telefoneMascarado: string;
}