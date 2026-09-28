import type { Cliente } from "../entities/Cliente";
import {
  boolean,
  createSchema,
  date,
  record,
  string,
} from "./schema-utils";

function parseCliente(input: unknown): Cliente {
  const value = record(input);
  return {
    id: string(value.id, "id"),
    bancaId: string(value.bancaId, "bancaId"),
    nome: string(value.nome, "nome"),
    nomeNormalizado: string(value.nomeNormalizado, "nomeNormalizado"),
    telefone: string(value.telefone, "telefone"),
    telefoneNormalizado: string(value.telefoneNormalizado, "telefoneNormalizado"),
    telefoneFinal: string(value.telefoneFinal, "telefoneFinal"),
    criadoEm: date(value.criadoEm, "criadoEm"),
    atualizadoEm: date(value.atualizadoEm, "atualizadoEm"),
    ativo: boolean(value.ativo, "ativo"),
  };
}

export const clienteSchema = createSchema(parseCliente);
export const parseClienteSchema = clienteSchema.parse;