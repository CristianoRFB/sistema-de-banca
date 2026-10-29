import { createContext, useContext, type ReactNode } from 'react';
import type { TenantBootstrap } from '../features/banca/tenant-bootstrap';

const TenantPublicContext = createContext<TenantBootstrap | null>(null);

/** Verified tenant metadata. Public routes mount only after bootstrap succeeds. */
export function TenantPublicProvider({ tenant, children }: { tenant: TenantBootstrap; children: ReactNode }) {
  return <TenantPublicContext.Provider value={tenant}>{children}</TenantPublicContext.Provider>;
}

export function useTenantPublic(): TenantBootstrap | null {
  return useContext(TenantPublicContext);
}
