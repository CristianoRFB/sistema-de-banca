import type { Banca, EnderecoBanca } from "../entities/Banca";
import {
  boolean,
  createSchema,
  date,
  integer,
  nullableNumber,
  nullableString,
  record,
  string,
} from "./schema-utils";

function parseBanca(input: unknown): Banca {
  const value = record(input);
  const enderecoValue = value.endereco;
  let endereco: Banca["endereco"] = null;
  if (typeof enderecoValue === "string") {
    endereco = enderecoValue;
  } else if (enderecoValue !== null) {
    const enderecoRecord = record(enderecoValue, "endereco");
    const parsed: EnderecoBanca = {
      logradouro: string(enderecoRecord.logradouro, "endereco.logradouro"),
      cidade: string(enderecoRecord.cidade, "endereco.cidade"),
      estado: string(enderecoRecord.estado, "endereco.estado"),
    };
    if (enderecoRecord.complemento !== undefined) {
      parsed.complemento = nullableString(enderecoRecord.complemento, "endereco.complemento");
    }
    if (enderecoRecord.cep !== undefined) {
      parsed.cep = nullableString(enderecoRecord.cep, "endereco.cep");
    }
    if (enderecoRecord.latitude !== undefined) {
      parsed.latitude = nullableNumber(enderecoRecord.latitude, "endereco.latitude");
    }
    if (enderecoRecord.longitude !== undefined) {
      parsed.longitude = nullableNumber(enderecoRecord.longitude, "endereco.longitude");
    }
    endereco = parsed;
  }

  return {
    id: string(value.id, "id"),
    nomeExibicao: string(value.nomeExibicao, "nomeExibicao"),
    slug: string(value.slug, "slug"),
    telefone: string(value.telefone, "telefone"),
    endereco,
    fotoFixaUrl: nullableString(value.fotoFixaUrl, "fotoFixaUrl"),
    margemRecolhimentoDias: integer(value.margemRecolhimentoDias, "margemRecolhimentoDias"),
    toleranciaRetiradaDias: integer(value.toleranciaRetiradaDias, "toleranciaRetiradaDias"),
    ativo: boolean(value.ativo, "ativo"),
    criadoEm: date(value.criadoEm, "criadoEm"),
    atualizadoEm: date(value.atualizadoEm, "atualizadoEm"),
  };
}

export const bancaSchema = createSchema(parseBanca);
export const parseBancaSchema = bancaSchema.parse;
