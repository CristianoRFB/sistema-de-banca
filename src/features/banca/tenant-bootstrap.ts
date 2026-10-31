import { apiRequest } from '../../infra/browser/api-client';

export interface TenantBranding {
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  textColor: string | null;
  logoUrl: string | null;
  tagline: string | null;
}

export interface TenantBootstrap {
  id: string;
  slug: string;
  name: string;
  phone: string | null;
  address: string | null;
  photoUrl: string | null;
  active: boolean;
  branding: TenantBranding;
}

export async function getTenantBootstrap(): Promise<TenantBootstrap> {
  const result = await apiRequest<{ tenant: TenantBootstrap }>('/public/tenant');
  return result.tenant;
}
