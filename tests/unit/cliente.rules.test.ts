import { describe, expect, it } from "vitest";
import { mascararTelefone } from "../../src/domain/rules/mascararTelefone";

describe("privacidade do cliente", () => {
  it("mascara os dígitos do telefone e deixa só o final reconhecível", () => {
    expect(mascararTelefone("+55 (17) 99153-6969")).toBe("••• (••) •••••-6969");
  });

  it("também mascara números curtos sem expor o telefone inteiro", () => {
    expect(mascararTelefone("1234")).toBe("••34");
  });
});
