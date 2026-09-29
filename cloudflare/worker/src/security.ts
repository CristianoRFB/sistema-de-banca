import { FirestoreRest } from "./firebase/firestore-rest";
import { HttpError, type AdminIdentity, type Bindings, type ClientIdentity, type RequestContext } from "./types";

interface FirebaseJwkSet {
  keys: JsonWebKey[];
}

interface FirebaseIdTokenClaims {
  aud: string;
  auth_time?: number;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  firebase?: Record<string, unknown>;
  [key: string]: unknown;
}

const jwkCache: { keys: JsonWebKey[]; expiresAt: number } = { keys: [], expiresAt: 0 };
const CLIENT_SESSION_RENEWAL_THRESHOLD_MS = 7 * 86_400_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeBase64UrlJson<T>(value: string): T {
  const bytes = fromBase64Url(value);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function hmac(pepper: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return toBase64Url(digest);
}

export async function verifyClientSessionSignature(env: Bindings, value: string, signature: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  let signatureBytes: Uint8Array;
  try { signatureBytes = fromBase64Url(signature); } catch { return false; }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CLIENT_SESSION_PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength);
  new Uint8Array(signatureBuffer).set(signatureBytes);
  return crypto.subtle.verify("HMAC", key, signatureBuffer, new TextEncoder().encode(`client-session:v1:${value}`));
}

export async function hashClientSessionToken(env: Bindings, token: string): Promise<string> {
  return hmac(env.CLIENT_SESSION_PEPPER, `client-session:v1:${token}`);
}

export async function hashCustomerPhone(env: Bindings, normalizedPhone: string): Promise<string> {
  return hmac(env.CLIENT_SESSION_PEPPER, `customer-phone:v1:${normalizedPhone}`);
}

export function createClientSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0055") && /^0055\d{10,11}$/.test(digits)) digits = digits.slice(2);
  if (digits.startsWith("55") && /^55\d{10,11}$/.test(digits)) return digits;
  if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
  return digits;
}

export function isBrazilianPhone(phone: string): boolean {
  return /^55\d{10,11}$/.test(phone);
}

export function phoneIndexCandidates(phone: string): string[] {
  const canonical = normalizePhone(phone);
  if (!isBrazilianPhone(canonical)) return [canonical];
  // Previous versions indexed national digits without the country code.
  // Read both keys so existing profiles cannot be duplicated during rollout.
  return [...new Set([canonical, canonical.slice(2)])];
}

export function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length < 8) return "***";
  const prefix = digits.startsWith("55") ? "+55 " : "";
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length < 10) return `${prefix}*****${local.slice(-2)}`;
  return `${prefix}(${local.slice(0, 2)}) *****-${local.slice(-4)}`;
}

export function allowedOrigin(request: Request, env: Bindings): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const allowed = env.CORS_ORIGINS.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!allowed.includes(origin)) {
    throw new HttpError({ code: "origin_not_allowed", message: "This origin is not allowed.", status: 403 });
  }
  return origin;
}

export async function rateLimit(ctx: RequestContext, scope: "public-search" | "client-session" | "client-read" | "client-write"): Promise<void> {
  if (!ctx.env.CLIENT_RATE_LIMITER) {
    throw new HttpError({ code: "rate_limit_unavailable", message: "Client routes are temporarily unavailable.", status: 503 });
  }
  const address = ctx.request.headers.get("cf-connecting-ip") ?? "unknown";
  const hashedAddress = await hmac(ctx.env.CLIENT_SESSION_PEPPER, `rate-limit:v1:${scope}:${address}`);
  const result = await ctx.env.CLIENT_RATE_LIMITER.limit({ key: hashedAddress });
  if (!result.success) throw new HttpError({ code: "rate_limited", message: "Too many requests. Try again shortly.", status: 429 });
}

export async function getClientIdentity(ctx: RequestContext): Promise<ClientIdentity> {
  const authorization = ctx.request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9_-]{40,80})$/);
  if (!match) throw new HttpError({ code: "session_required", message: "A valid client session is required.", status: 401 });
  const sessionId = await hashClientSessionToken(ctx.env, match[1]);
  const sessionDoc = await ctx.db.get(`sessoesClientes/${sessionId}`);
  const sessionExpiresAt = Date.parse(String(sessionDoc?.data.expiraEm ?? ""));
  if (!sessionDoc || sessionDoc.data.ativa !== true || sessionDoc.data.bancaId !== ctx.env.BANCA_ID || !Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= Date.now()) {
    throw new HttpError({ code: "session_invalid", message: "The client session is invalid or has expired.", status: 401 });
  }
  const clientId = String(sessionDoc.data.clienteId ?? "");
  const clientDoc = await ctx.db.get(`clientes/${clientId}`);
  if (!clientDoc || clientDoc.data.ativo !== true || clientDoc.data.bancaId !== ctx.env.BANCA_ID) {
    throw new HttpError({ code: "session_invalid", message: "The client session is invalid or has expired.", status: 401 });
  }
  if (sessionExpiresAt - Date.now() <= CLIENT_SESSION_RENEWAL_THRESHOLD_MS) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    await ctx.db.transact(async (transaction) => {
      const current = await transaction.get(`sessoesClientes/${sessionId}`);
      const currentExpiry = Date.parse(String(current?.data.expiraEm ?? ""));
      if (!current || current.data.ativa !== true || current.data.bancaId !== ctx.env.BANCA_ID || current.data.clienteId !== clientId || !Number.isFinite(currentExpiry) || currentExpiry <= now.getTime()) {
        throw new HttpError({ code: "session_invalid", message: "The client session is invalid or has expired.", status: 401 });
      }
      transaction.set(`sessoesClientes/${sessionId}`, {
        ...current.data,
        expiraEm: expiresAt,
        ultimoAcesso: now.toISOString(),
      });
    });
  }
  return { sessionId, clientId, session: sessionDoc.data, client: clientDoc.data };
}

async function secureTokenJwks(): Promise<JsonWebKey[]> {
  if (jwkCache.keys.length && jwkCache.expiresAt > Date.now()) return jwkCache.keys;
  const response = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!response.ok) throw new HttpError({ code: "auth_provider_unavailable", message: "Could not verify the admin credential.", status: 503 });
  const data = await response.json() as FirebaseJwkSet;
  if (!Array.isArray(data.keys)) throw new HttpError({ code: "auth_provider_unavailable", message: "Could not verify the admin credential.", status: 503 });
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? "3600");
  jwkCache.keys = data.keys;
  jwkCache.expiresAt = Date.now() + Math.min(Math.max(maxAge, 60), 21_600) * 1000;
  return jwkCache.keys;
}

async function verifyFirebaseIdToken(token: string, projectId: string): Promise<FirebaseIdTokenClaims> {
  const pieces = token.split(".");
  if (pieces.length !== 3) throw new HttpError({ code: "admin_auth_required", message: "A valid Firebase ID token is required.", status: 401 });

  let header: { alg?: string; kid?: string; typ?: string };
  let claims: FirebaseIdTokenClaims;
  try {
    header = decodeBase64UrlJson(pieces[0]);
    claims = decodeBase64UrlJson(pieces[1]);
  } catch {
    throw new HttpError({ code: "admin_auth_required", message: "A valid Firebase ID token is required.", status: 401 });
  }
  if (header.alg !== "RS256" || !header.kid) throw new HttpError({ code: "admin_auth_required", message: "A valid Firebase ID token is required.", status: 401 });
  const jwk = (await secureTokenJwks()).find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new HttpError({ code: "admin_auth_required", message: "A valid Firebase ID token is required.", status: 401 });
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = new Uint8Array(fromBase64Url(pieces[2]));
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 300 ||
    !Number.isFinite(claims.auth_time) || Number(claims.auth_time) > now + 300) {
    throw new HttpError({ code: "admin_auth_required", message: "A valid Firebase ID token is required.", status: 401 });
  }
  return claims;
}

export async function requireAdmin(ctx: RequestContext, allowedRoles: Array<"ADMIN" | "OPERADOR"> = ["ADMIN", "OPERADOR"]): Promise<AdminIdentity> {
  const authorization = ctx.request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  if (!match) throw new HttpError({ code: "admin_auth_required", message: "A Firebase ID token is required.", status: 401 });
  const claims = await verifyFirebaseIdToken(match[1], ctx.env.FIREBASE_PROJECT_ID);
  const user = await ctx.db.get(`bancas/${ctx.env.BANCA_ID}/usuarios/${claims.sub}`);
  const role = user?.data.papel;
  if (!user || user.data.ativo !== true || (role !== "ADMIN" && role !== "OPERADOR") || !allowedRoles.includes(role)) {
    throw new HttpError({ code: "admin_forbidden", message: "This account is not authorized for this bank operation.", status: 403 });
  }
  return { uid: claims.sub, role, claims: claims as Record<string, unknown> };
}

export function publicProfile(data: Record<string, unknown>): Record<string, unknown> {
  return {
    nomeExibicao: data.nomeExibicao ?? null,
    slug: data.slug ?? null,
    telefone: data.telefone ?? null,
    endereco: data.endereco ?? null,
    fotoFixaUrl: data.fotoFixaUrl ?? null,
    ativo: data.ativo === true,
  };
}

export function clientSessionProfile(clientId: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    clientId,
    name: data.nome ?? "",
    phone: data.telefone ?? "",
  };
}

export function dbForContext(env: Bindings): FirestoreRest {
  return new FirestoreRest(env);
}
