/**
 * Deixa visíveis somente os quatro últimos dígitos (no máximo) e mantém
 * a pontuação digitada (sem expor o prefixo internacional) para que a pessoa reconheça o próprio contato.
 */
export function mascararTelefone(telefone: string): string {
  const telefoneFormatado = telefone.startsWith("+") ? `•${telefone.slice(1)}` : telefone;
  const totalDigitos = (telefone.match(/\d/g) ?? []).length;
  const visiveis = Math.min(4, Math.max(0, totalDigitos - 2));
  let indiceDigito = 0;
  const limiteVisivel = totalDigitos - visiveis;

  return telefoneFormatado.replace(/\d/g, (digito) => {
    const deveExibir = indiceDigito >= limiteVisivel;
    indiceDigito += 1;
    return deveExibir ? digito : "•";
  });
}
