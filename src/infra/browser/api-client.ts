import { apiBaseUrl } from '../../app/config';

let cachedPublicDataFallback = false;
const cacheFallbackListeners = new Set<() => void>();

export function isUsingCachedPublicData(): boolean {
  return cachedPublicDataFallback;
}

export function subscribeCachedPublicData(listener: () => void): () => void {
  cacheFallbackListeners.add(listener);
  return () => cacheFallbackListeners.delete(listener);
}

function setCachedPublicDataFallback(isFallback: boolean): void {
  if (cachedPublicDataFallback === isFallback) return;
  cachedPublicDataFallback = isFallback;
  for (const listener of cacheFallbackListeners) listener();
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ApiErrorEnvelope = { error: { message?: string; code?: string } };

function hasApiError(payload: unknown): payload is ApiErrorEnvelope {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return false;
  const error = payload.error;
  return typeof error === 'object' && error !== null;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const requestUrl = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const isPublicCatalogRead = method === 'GET' && /^\/api\/public\/(?:banca|catalog(?:\/[A-Za-z0-9_-]+)?)$/.test(new URL(requestUrl, window.location.origin).pathname);
  const response = await fetch(requestUrl, {
    ...init,
    headers,
    credentials: 'omit',
  });

  if (isPublicCatalogRead) {
    setCachedPublicDataFallback(response.headers.get('x-public-data-cache') === 'fallback');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      hasApiError(payload) && typeof payload.error.message === 'string' ? payload.error.message : 'Não foi possível concluir a solicitação.',
      response.status,
      hasApiError(payload) && typeof payload.error.code === 'string' ? payload.error.code : undefined,
    );
  }
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) throw new ApiError('Resposta inválida do serviço.', response.status);
  return payload.data as T;
}

export const jsonBody = (value: unknown): Pick<RequestInit, 'body' | 'method'> => ({
  method: 'POST',
  body: JSON.stringify(value),
});
