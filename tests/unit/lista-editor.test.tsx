import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ImportedListRow } from "../../src/features/importacao/importacao.types";

const { adminUser, getListMock, createListMock, updateListMock } = vi.hoisted(() => ({
  adminUser: { uid: "admin-1" },
  getListMock: vi.fn(),
  createListMock: vi.fn(),
  updateListMock: vi.fn(),
}));

vi.mock("../../src/app/providers", () => ({
  useAdminAuth: () => ({ user: adminUser, loading: false }),
}));
vi.mock("../../src/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("../../src/features/admin/admin.repository", () => ({
  adminRepository: {
    getList: getListMock,
    createList: createListMock,
    updateList: updateListMock,
  },
}));

import { TabelaRevisao } from "../../src/features/listas/components/TabelaRevisao";
import { RevisarListaPage } from "../../src/pages/admin/RevisarListaPage";
import { NovaListaPage } from "../../src/pages/admin/NovaListaPage";
import { attachSavedItemIdentities, hasCompleteSavedItemIdentities, mapAdminItemsToImportedRows, toAdminListItemInput } from "../../src/features/listas/lista.mappers";

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createListMock.mockReset();
  updateListMock.mockReset();
});

function importedRow(): ImportedListRow {
  return {
    id: "list-row-1",
    itemReparteId: "stock-1",
    productId: "product-1",
    line: 1,
    title: "Wistoria",
    volume: "09",
    price: 29.9,
    quantity: 3,
    code: "COD-1",
    publisher: "Editora antiga",
    originalTitle: "原題",
    returnDate: "2026-12-01",
    type: "MANGA",
    confidence: 0.9,
    fieldConfidence: {},
    issues: [],
    requiresReview: false,
  };
}

describe("edição e revisão de listas", () => {
  it("permite corrigir campos importados e preserva as identidades do estoque", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function ControlledReviewTable() {
      const [rows, setRows] = useState([importedRow()]);
      return <TabelaRevisao rows={rows} onChange={(next) => { onChange(next); setRows(next); }} />;
    }
    render(<ControlledReviewTable />);

    await user.clear(screen.getByRole("textbox", { name: "Código, linha 1" }));
    await user.type(screen.getByRole("textbox", { name: "Código, linha 1" }), "978123");
    await user.clear(screen.getByRole("textbox", { name: "Editora, linha 1" }));
    await user.type(screen.getByRole("textbox", { name: "Editora, linha 1" }), "Nova editora");
    await user.clear(screen.getByRole("textbox", { name: "Título original, linha 1" }));
    await user.type(screen.getByRole("textbox", { name: "Título original, linha 1" }), "Wistoria");
    await user.clear(screen.getByLabelText("Data de recolhimento, linha 1"));
    await user.type(screen.getByLabelText("Data de recolhimento, linha 1"), "2027-01-15");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tipo de produto, linha 1" }), "BOX");

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "list-row-1",
        itemReparteId: "stock-1",
        productId: "product-1",
        code: "978123",
        publisher: "Nova editora",
        originalTitle: "Wistoria",
        returnDate: "2027-01-15",
        type: "BOX",
        requiresReview: true,
      }),
    ]);
    expect(screen.getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual([
      "MANGA", "REVISTA", "BOX", "COLECIONAVEL", "OUTRO",
    ]);
  });

  it("envia os IDs de lote e produto existentes ao salvar uma lista", async () => {
    const user = userEvent.setup();
    getListMock.mockResolvedValue({
      list: { id: "list-1", title: "Novidades", status: "PUBLICADA", createdAt: "2026-09-01T12:00:00Z", totalItems: 1 },
      items: [{
        id: "list-item-1",
        itemReparteId: "stock-1",
        productId: "product-1",
        title: "Wistoria",
        volume: "09",
        price: 29.9,
        quantity: 3,
        code: "COD-1",
        publisher: "Editora antiga",
        originalTitle: "原題",
        returnDate: "2026-12-01",
        type: "REVISTA",
        confidence: 0.9,
        issues: [],
        requiresReview: false,
        active: true,
      }],
    });
    updateListMock.mockResolvedValue({ listId: "list-1", reparteId: "reparte-1", status: "PUBLICADA", itemCount: 1, version: 2 });

    render(<MemoryRouter initialEntries={["/admin/listas/list-1"]}>
      <Routes><Route path="/admin/listas/:listaId" element={<RevisarListaPage />} /></Routes>
    </MemoryRouter>);

    await screen.findByDisplayValue("Wistoria");
    expect(screen.getByLabelText("Tipo de produto, linha 1")).toHaveValue("REVISTA");
    await user.clear(screen.getByLabelText("Data de recolhimento, linha 1"));
    await user.type(screen.getByLabelText("Data de recolhimento, linha 1"), "2027-01-15");
    expect(screen.getByLabelText("Data de recolhimento, linha 1")).toHaveValue("2027-01-15");
    await user.click(screen.getByRole("button", { name: "Salvar agora" }));

    await waitFor(() => expect(updateListMock).toHaveBeenCalled());
    expect(updateListMock).toHaveBeenCalledWith(adminUser, "list-1", expect.objectContaining({
      items: [expect.objectContaining({
        itemReparteId: "stock-1",
        productId: "product-1",
        type: "REVISTA",
        returnDate: "2027-01-15",
      })],
    }));
  });

  it("reconcilia o rascunho importado com os IDs retornados ao salvar", async () => {
    const user = userEvent.setup();
    createListMock.mockResolvedValue({ listId: "list-created", reparteId: "reparte-1", status: "RASCUNHO", itemCount: 1, version: 1 });
    getListMock.mockImplementation(async () => {
      const input = createListMock.mock.calls[0]?.[1] as { items: Array<Record<string, unknown>> };
      return {
        list: { id: "list-created", title: "Novidades", status: "RASCUNHO", createdAt: "2026-09-01T12:00:00Z", totalItems: 1 },
        items: input.items.map((item, index) => ({
          ...item,
          id: `list-item-${index + 1}`,
          itemReparteId: `stock-${index + 1}`,
          productId: `product-${index + 1}`,
          active: true,
        })),
      };
    });
    updateListMock.mockResolvedValue({ listId: "list-created", reparteId: "reparte-1", status: "RASCUNHO", itemCount: 1, version: 2 });

    render(<MemoryRouter initialEntries={["/admin/listas/nova"]}><Routes><Route path="/admin/listas/nova" element={<NovaListaPage />} /></Routes></MemoryRouter>);
    await user.type(screen.getByLabelText("Ou cole uma linha por produto"), "Wistoria 09");
    await user.click(screen.getByRole("button", { name: "Criar rascunho manual" }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateListMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(createListMock).toHaveBeenCalledWith(adminUser, expect.objectContaining({
      items: [expect.objectContaining({ title: "Wistoria", volume: "09", type: "MANGA" })],
    }));
    expect(updateListMock).toHaveBeenCalledWith(adminUser, "list-created", expect.objectContaining({
      items: [expect.objectContaining({ itemReparteId: "stock-1", productId: "product-1" })],
    }));
  });

  it("não associa IDs por posição quando o rascunho local não corresponde à lista salva", () => {
    const rows = mapAdminItemsToImportedRows([{
      id: "list-item-1", itemReparteId: "stock-1", productId: "product-1", title: "Servidor", volume: "01", active: true,
    }]);
    const editedLocally = [{ ...rows[0], id: "local-row", itemReparteId: undefined, productId: undefined, title: "Editado localmente" }];
    const attached = attachSavedItemIdentities(editedLocally, [{
      id: "list-item-1", itemReparteId: "stock-1", productId: "product-1", title: "Servidor", volume: "01", active: true,
    }]);

    expect(hasCompleteSavedItemIdentities(attached, [{
      id: "list-item-1", itemReparteId: "stock-1", productId: "product-1", title: "Servidor", volume: "01", active: true,
    }])).toBe(false);
    expect(toAdminListItemInput(attached[0])).not.toHaveProperty("itemReparteId");
  });
});
