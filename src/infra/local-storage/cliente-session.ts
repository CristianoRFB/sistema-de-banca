import type { SessaoCliente } from '../../features/cliente/cliente.types';

const SESSION_KEY = 'banca-ana-maria:cliente-session:v1';

export function lerSessaoCliente(): SessaoCliente | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SessaoCliente>;
    if (typeof parsed.token !== 'string' || typeof parsed.clienteId !== 'string' || typeof parsed.nome !== 'string') return null;
    return parsed as SessaoCliente;
  } catch {
    return null;
  }
}

export function salvarSessaoCliente(session: SessaoCliente) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function removerSessaoCliente() {
  localStorage.removeItem(SESSION_KEY);
}
