export type Bindings = Env;

export type JsonObject = Record<string, unknown>;

export interface FirestoreDocument {
  name: string;
  id: string;
  updateTime?: string;
  data: JsonObject;
}

export interface HttpErrorOptions {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

export class HttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(options: HttpErrorOptions) {
    super(options.message);
    this.name = "HttpError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export interface AdminIdentity {
  uid: string;
  role: "ADMIN" | "OPERADOR";
  claims: JsonObject;
}

export interface ClientIdentity {
  sessionId: string;
  clientId: string;
  session: JsonObject;
  client: JsonObject;
}

export interface RequestContext {
  request: Request;
  url: URL;
  env: Bindings;
  db: import("./firebase/firestore-rest").FirestoreRest;
  corsOrigin: string | null;
}
