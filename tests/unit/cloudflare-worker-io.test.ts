import { describe, expect, it } from "vitest";
import { readJsonBody } from "../../cloudflare/worker/src/api";
import { FirestoreRest, TransactionConflict } from "../../cloudflare/worker/src/firebase/firestore-rest";
import { HttpError, type Bindings } from "../../cloudflare/worker/src/types";

function testEnv(): Bindings {
  return {
    FIREBASE_PROJECT_ID: "worker-io-test",
    BANCA_ID: "test-bank",
    FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
    CLIENT_SESSION_PEPPER: "unit-test-pepper-with-at-least-thirty-two-bytes",
    CORS_ORIGINS: "https://banca.example.test",
  };
}

function streamingRequest(
  chunks: Uint8Array[],
  options: { contentLength?: string; keepOpen?: boolean } = {},
): { request: Request; wasCancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (!options.keepOpen) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  const request = new Request("https://banca.example.test/api/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
  return { request, wasCancelled: () => cancelled };
}

describe("Cloudflare Worker bounded JSON input", () => {
  it("rejects an oversized declared body before reading it", async () => {
    const { request } = streamingRequest([new TextEncoder().encode('{"ok":true}')], { contentLength: "100" });

    await expect(readJsonBody(request, 20)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
  });

  it("cancels an oversized stream when Content-Length is absent", async () => {
    const { request, wasCancelled } = streamingRequest([new Uint8Array(21)], { keepOpen: true });

    await expect(readJsonBody(request, 20)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
    expect(wasCancelled()).toBe(true);
  });

  it("enforces the stream limit when Content-Length understates the body", async () => {
    const { request, wasCancelled } = streamingRequest([new Uint8Array(21)], { contentLength: "1", keepOpen: true });

    await expect(readJsonBody(request, 20)).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
    expect(wasCancelled()).toBe(true);
  });

  it("decodes valid JSON when a multibyte character is split across chunks", async () => {
    const encoded = new TextEncoder().encode('{"name":"á"}');
    const splitAt = encoded.indexOf(0xc3) + 1;
    const { request } = streamingRequest([encoded.slice(0, splitAt), encoded.slice(splitAt)]);

    await expect(readJsonBody(request, 20)).resolves.toEqual({ name: "á" });
  });
});

class TransactionLifecycleFirestore extends FirestoreRest {
  beginCalls = 0;
  commitCalls = 0;
  rollbackCalls: string[] = [];
  conflictsRemaining = 0;
  rollbackFails = false;

  constructor() {
    super(testEnv());
  }

  override async beginTransaction(): Promise<string> {
    this.beginCalls += 1;
    return `transaction-${this.beginCalls}`;
  }

  override async commit(): Promise<void> {
    this.commitCalls += 1;
    if (this.conflictsRemaining > 0) {
      this.conflictsRemaining -= 1;
      throw new TransactionConflict();
    }
  }

  override async rollback(transactionId: string): Promise<void> {
    this.rollbackCalls.push(transactionId);
    if (this.rollbackFails) throw new Error("rollback failed");
  }
}

describe("Cloudflare Worker Firestore transaction lifecycle", () => {
  it("attempts rollback and preserves the operation error if rollback fails", async () => {
    const db = new TransactionLifecycleFirestore();
    db.rollbackFails = true;
    const operationError = new HttpError({ code: "invalid_request", message: "Invalid test operation.", status: 400 });

    await expect(db.transact(async (transaction) => {
      transaction.set("test/document", { value: "staged" });
      throw operationError;
    })).rejects.toBe(operationError);
    expect(db.rollbackCalls).toEqual(["transaction-1"]);
  });

  it("attempts rollback for a read-only transaction without masking its result", async () => {
    const db = new TransactionLifecycleFirestore();
    db.rollbackFails = true;

    await expect(db.transact(async () => "read-result")).resolves.toBe("read-result");
    expect(db.rollbackCalls).toEqual(["transaction-1"]);
  });

  it("rolls back every conflicted attempt and reports 409 after exhausting retries", async () => {
    const db = new TransactionLifecycleFirestore();
    db.conflictsRemaining = 3;
    db.rollbackFails = true;

    const result = db.transact(async (transaction) => {
      transaction.set("test/document", { value: "test" });
      return "unused";
    }, 3);

    await expect(result).rejects.toMatchObject({ code: "concurrent_update", status: 409 });
    expect(db.beginCalls).toBe(3);
    expect(db.commitCalls).toBe(3);
    expect(db.rollbackCalls).toEqual(["transaction-1", "transaction-2", "transaction-3"]);
  });

  it("retries a conflict and returns the successful attempt result", async () => {
    const db = new TransactionLifecycleFirestore();
    db.conflictsRemaining = 1;

    const result = await db.transact(async (transaction) => {
      transaction.set("test/document", { value: "test" });
      return "saved";
    });

    expect(result).toBe("saved");
    expect(db.commitCalls).toBe(2);
    expect(db.rollbackCalls).toEqual(["transaction-1"]);
  });
});
