import { describe, expect, it } from "vitest";
import type { ItemLista } from "../../src/domain/entities/ItemLista";
import { ListaStatus } from "../../src/domain/enums/ListaStatus";
import {
  ocultarItemLista,
  validarRemocaoItemLista,
  validarTransicaoLista,
} from "../../src/features/listas/lista.rules";

const item: ItemLista = {
  id: "il-1",
  listaId: "l-1",
  bancaId: "b-1",
  itemReparteId: "ir-1",
  produtoId: "p-1",
  ordem: 1,
  tituloExibicao: "Produto",
  precoExibicao: 12,
  ativo: true,
};

describe("regras de lista", () => {
  it("oculta novas reservas sem apagar a identidade do item", () => {
    expect(ocultarItemLista(item)).toMatchObject({
      id: item.id,
      itemReparteId: item.itemReparteId,
      ativo: false,
    });
    expect(validarRemocaoItemLista(item, 1).ok).toBe(false);
  });

  it("aplica os estados canônicos em ordem", () => {
    expect(validarTransicaoLista({ status: ListaStatus.RASCUNHO }, ListaStatus.PUBLICADA).ok).toBe(true);
    expect(validarTransicaoLista({ status: ListaStatus.PUBLICADA }, ListaStatus.RASCUNHO).ok).toBe(false);
  });
});