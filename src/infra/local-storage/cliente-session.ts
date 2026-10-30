import type { SessaoCliente } from '../../features/cliente/cliente.types';
import { currentTenantSlug } from '../../app/tenant';

// Legacy storage belongs exclusively to Banca Ana Maria; never load it on other tenants.
const LEGACY_SESSION_KEY = 'banca-ana-maria:cliente-session:v1';
const SESSION_PREFIX = 'banca:cliente-session:v2:';

function tenantSessionKey(): string {
  return `${SESSION_PREFIX}${currentTenantSlug()}`;
}

function parseSession(value: string | null): SessaoCliente | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const session = parsed as Partial<SessaoCliente>;
    return typeof session.token === 'string' && session.token.length > 0
      && typeof session.clienteId === 'string' && session.clienteId.length > 0
      && typeof session.nome === 'string' && session.nome.length > 0
      ? { token: session.token, clienteId: session.clienteId, nome: session.nome }
      : null;
  } catch {
    return null;
  }
}

export function lerSessaoCliente(): SessaoCliente | null {
  try {
    const scopedSession = parseSession(localStorage.getItem(tenantSessionKey()));
    if (scopedSession) return scopedSession;

    // One-time migration for existing Ana Maria devices. A foreign tenant must
    // never render the former global session, even if the Worker rejects its token.
    if (currentTenantSlug() !== 'banca-ana-maria') return null;
    const legacySession = parseSession(localStorage.getItem(LEGACY_SESSION_KEY));
    if (!legacySession) return null;
    localStorage.setItem(tenantSessionKey(), JSON.stringify(legacySession));
    localStorage.removeItem(LEGACY_SESSION_KEY);
    return legacySession;
  } catch {
    return null;
  }
}

export function salvarSessaoCliente(session: SessaoCliente): void {
  localStorage.setItem(tenantSessionKey(), JSON.stringify(session));
  if (currentTenantSlug() === 'banca-ana-maria') {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }
}

export function removerSessaoCliente(): void {
  localStorage.removeItem(tenantSessionKey());
  if (currentTenantSlug() === 'banca-ana-maria') {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  }
}
