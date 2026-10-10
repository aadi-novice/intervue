import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BackendClient, backoffDelay, signPayload, signedHeaders } from "../../src/backend-client.js";
import { createSilentLogger } from "../../src/logger.js";

describe("signing", () => {
  it("matches hex(hmac_sha256(secret, '<ts>.' + body))", () => {
    const expected = createHmac("sha256", "s3cret").update('1700000000.{"a":1}').digest("hex");
    expect(signPayload("s3cret", 1700000000, '{"a":1}')).toBe(expected);
  });
  it("uses the empty string body for GET", () => {
    const expected = createHmac("sha256", "k").update("42.").digest("hex");
    expect(signPayload("k", "42", "")).toBe(expected);
  });
  it("sets X-Timestamp in unix seconds and a matching signature", () => {
    const h = signedHeaders("k", "{}", 1_700_000_000_999);
    expect(h["X-Timestamp"]).toBe("1700000000");
    expect(h["X-Signature"]).toBe(signPayload("k", "1700000000", "{}"));
    expect(h["Content-Type"]).toBe("application/json");
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and is capped", () => {
    const max = (n: number) => backoffDelay(n, 500, 15000, () => 1);
    const min = (n: number) => backoffDelay(n, 500, 15000, () => 0);
    expect([1, 2, 3, 4].map(max)).toEqual([500, 1000, 2000, 4000]);
    expect(min(1)).toBe(250);
    expect(max(20)).toBe(15000);
    expect(min(20)).toBe(7500);
  });
});

function client(fetchImpl: typeof fetch) {
  const sleep = vi.fn(async () => undefined);
  const c = new BackendClient({
    baseUrl: "http://backend:8000/",
    sessionId: "sess1",
    secret: "k",
    logger: createSilentLogger(),
    fetch: fetchImpl,
    sleep,
    now: () => 1_700_000_000_000,
    random: () => 0,
  });
  return { c, sleep };
}

const ok = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });
const asFetch = (f: unknown) => f as typeof fetch;

describe("BackendClient", () => {
  it("POSTs signed events to /internal/bots/{id}/events", async () => {
    const f = vi.fn(async () => ok());
    const { c } = client(asFetch(f));
    const event = { type: "consent_sent", at: "2026-01-01T00:00:00.000Z" } as const;
    expect(await c.sendEvent(event)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const raw = JSON.stringify(event);
    expect(url).toBe("http://backend:8000/internal/bots/sess1/events");
    expect(init.body).toBe(raw);
    const h = init.headers as Record<string, string>;
    expect(h["X-Signature"]).toBe(signPayload("k", "1700000000", raw));
  });

  it("retries 5xx with backoff up to 5 attempts, then gives up without throwing", async () => {
    const f = vi.fn(async () => ok({}, 503));
    const { c, sleep } = client(asFetch(f));
    expect(await c.sendEvent({ type: "consent_sent", at: "x" })).toBe(false);
    expect(f).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("does not retry 4xx", async () => {
    const f = vi.fn(async () => ok({}, 422));
    const { c } = client(asFetch(f));
    expect(await c.sendEvent({ type: "consent_sent", at: "x" })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("recovers after transient network errors", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      if (++n < 3) throw new Error("ECONNRESET");
      return ok();
    });
    const { c } = client(asFetch(f));
    expect(await c.sendEvent({ type: "consent_sent", at: "x" })).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("sends events in order", async () => {
    const seen: string[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(JSON.parse(init.body as string).status);
      return ok();
    });
    const { c } = client(asFetch(f));
    void c.sendEvent({ type: "status", status: "joining", at: "x" });
    void c.sendEvent({ type: "status", status: "in_call", at: "x" });
    await c.drain();
    expect(seen).toEqual(["joining", "in_call"]);
  });

  it("uploads via presigned URL: upload-url then PUT with returned headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/upload-url")) {
        return ok({ url: "https://s3.example/put?sig=1", headers: { "Content-Type": "audio/ogg", "x-amz-foo": "1" } });
      }
      return new Response("", { status: 200 });
    });
    const { c } = client(asFetch(f));
    await c.uploadBlob("recordings/sess1/0001.opus", new Uint8Array([1, 2, 3]), "audio/ogg");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      blob: "recordings/sess1/0001.opus",
      content_type: "audio/ogg",
    });
    expect(calls[1]!.url).toBe("https://s3.example/put?sig=1");
    expect(calls[1]!.init.method).toBe("PUT");
    expect(calls[1]!.init.headers).toEqual({ "Content-Type": "audio/ogg", "x-amz-foo": "1" });
  });

  it("uploadBlob retries then throws", async () => {
    const f = vi.fn(async () => ok({}, 500));
    const { c } = client(asFetch(f));
    await expect(c.uploadBlob("b", new Uint8Array(1), "audio/ogg", { attempts: 3 })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("control: GET with empty-body signature; failures yield none", async () => {
    const f = vi.fn(async () => ok({ action: "stop" }));
    const { c } = client(asFetch(f));
    expect(await c.getControl()).toBe("stop");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://backend:8000/internal/bots/sess1/control");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Signature"]).toBe(signPayload("k", "1700000000", ""));
    const { c: c2 } = client(asFetch(async () => ok({}, 500)));
    expect(await c2.getControl()).toBe("none");
  });
});
