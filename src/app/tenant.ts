const env = import.meta.env;

export const DEFAULT_TENANT_SLUG = String(
  env.VITE_DEFAULT_TENANT_SLUG || env.VITE_BANCA_ID || 'banca-ana-maria',
).trim().toLocaleLowerCase('pt-BR');

const LEGACY_FIRST_SEGMENTS = new Set(['admin', 'catalogo', 'produto', 'cliente', 'localizacao']);

export function normalizeTenantSlug(value: string | undefined | null): string {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(normalized) ? normalized : DEFAULT_TENANT_SLUG;
}

export function tenantSlugFromPathname(pathname: string): string {
  const first = pathname.split('/').filter(Boolean)[0];
  if (!first || LEGACY_FIRST_SEGMENTS.has(first)) return DEFAULT_TENANT_SLUG;
  return normalizeTenantSlug(first);
}

export function currentTenantSlug(): string {
  if (typeof window === 'undefined') return DEFAULT_TENANT_SLUG;
  return tenantSlugFromPathname(window.location.pathname);
}

export function tenantPath(slug: string, suffix = ''): string {
  const tenantSlug = normalizeTenantSlug(slug);
  const cleanSuffix = suffix.replace(/^\/+/, '');
  return cleanSuffix ? `/${tenantSlug}/${cleanSuffix}` : `/${tenantSlug}`;
}

export function tenantPanelPath(slug: string, suffix = ''): string {
  const cleanSuffix = suffix.replace(/^\/+/, '');
  return tenantPath(slug, cleanSuffix ? `painel/${cleanSuffix}` : 'painel');
}
