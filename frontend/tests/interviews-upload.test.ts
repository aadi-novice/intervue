import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putToPresignedUrl, uploadRecording, type XhrLike } from "@/lib/api-interviews";
import { ApiError } from "@/lib/api";

class FakeXhr implements XhrLike {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 200;
  withCredentials = true;
  upload: XhrLike["upload"] = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(b: unknown) {
    this.body = b;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

describe("putToPresignedUrl", () => {
  it("PUTs with only the API-provided headers, no credentials, and reports progress", async () => {
    document.cookie = "csrf_token=secret";
    const progress: number[] = [];
    await putToPresignedUrl("https://s3.example/bucket/key?sig=1", new Blob(["x"]), { "Content-Type": "audio/mpeg" }, (f) => progress.push(f), () => new FakeXhr());
    const x = FakeXhr.last;
    expect(x.method).toBe("PUT");
    expect(x.url).toBe("https://s3.example/bucket/key?sig=1");
    expect(x.withCredentials).toBe(false);
    expect(x.headers).toEqual({ "Content-Type": "audio/mpeg" });
    expect(progress).toEqual([0.5, 1]);
  });

  it("rejects on non-2xx", async () => {
    class Failing extends FakeXhr {
      status = 403;
    }
    await expect(putToPresignedUrl("https://s3.example/x", new Blob(["x"]), {}, undefined, () => new Failing())).rejects.toBeInstanceOf(ApiError);
  });
});

describe("uploadRecording", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("presigns, PUTs to storage, then completes", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ upload_url: "https://s3.example/k", key: "k1", headers: { "Content-Type": "audio/mpeg" }, max_bytes: 1_000_000 }))
      .mockImplementationOnce(() => ok({ status: "queued", recording_id: 1 }, 202));
    const file = new File(["abc"], "call.mp3", { type: "audio/mpeg" });
    const progress: number[] = [];
    await uploadRecording(12, file, { onProgress: (f) => progress.push(f), makeXhr: () => new FakeXhr() });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [startUrl, startInit] = fetchMock.mock.calls[0];
    expect(startUrl).toBe("/api/interviews/12/recording-upload");
    expect(JSON.parse(startInit.body)).toEqual({ content_type: "audio/mpeg" });
    const [doneUrl, doneInit] = fetchMock.mock.calls[1];
    expect(doneUrl).toBe("/api/interviews/12/recording-upload/complete");
    expect(JSON.parse(doneInit.body)).toEqual({ key: "k1" });
    // The storage PUT carried no CSRF / org headers.
    expect(Object.keys(FakeXhr.last.headers)).toEqual(["Content-Type"]);
    expect(progress.at(-1)).toBe(1);
  });

  it("does not call complete when the PUT fails", async () => {
    class Failing extends FakeXhr {
      status = 500;
    }
    fetchMock.mockImplementationOnce(() => ok({ upload_url: "https://s3.example/k", key: "k1", headers: {}, max_bytes: 1_000_000 }));
    await expect(uploadRecording(12, new File(["abc"], "a.mp3", { type: "audio/mpeg" }), { makeXhr: () => new Failing() })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces 422 codes from the presign call", async () => {
    fetchMock.mockImplementationOnce(() => ok({ detail: "Unsupported audio/video type", code: "unsupported_file" }, 422));
    await expect(uploadRecording(12, new File(["a"], "a.exe", { type: "application/x-msdownload" }))).rejects.toMatchObject({ code: "unsupported_file", status: 422 });
  });
});
