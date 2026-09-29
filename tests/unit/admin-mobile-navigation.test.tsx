import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AdminShell } from "../../src/app/layouts/AdminShell";

describe("navegação administrativa no celular", () => {
  it("mantém acessíveis os oito fluxos administrativos", () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AdminShell />
      </MemoryRouter>,
    );

    const mobileNav = screen.getByRole("navigation", {
      name: "Navegação administrativa no celular",
    });
    const links = within(mobileNav).getAllByRole("link");

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin",
      "/admin/listas",
      "/admin/reservas",
      "/admin/retiradas",
      "/admin/recolhimentos",
      "/admin/historico",
      "/admin/perfil",
      "/admin/configuracoes",
    ]);
    expect(within(mobileNav).getByRole("link", { name: "Configurações" })).toBeInTheDocument();
  });
});
