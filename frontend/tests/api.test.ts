import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, navigation } from "@/lib/api";
import { useAuthStore, type MeResponse } from "@/lib/auth-store";

const ME: MeResponse = {
  user: { id: 1, email: "a@b.co", full_name: "A", avatar_url: null, email_verified: true },
  orgs: [{ id: 7, name: "Acme", slug: "acme", role: "admin", settings: {} }],
};

function jsonRes(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function headersOf(call: unknown[]): Headers {
  return new Headers((call[1] as RequestInit).headers);
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.cookie = "csrf_token=csrf123; path=/";
  useAuthStore.setState({ user: null, orgs: [], currentOrgId: 7 });
  vi.spyOn(navigation, "toLogin").mockImplementation(() => {});
});

describe("api client", () => {
  it("sends CSRF header on POST but not on GET, plus credentials and X-Org-Id", async () => {
    fetchMock.mockImplementation(async () => jsonRes(200, []));
    await api.roles.list();
    await api.roles.create({ name: "x", experience_level: "senior", experience_required_years: 3 });

    const [get, post] = fetchMock.mock.calls;
    expect(get[0]).toBe("/api/roles/");
    expect(headersOf(get).get("X-CSRF-Token")).toBeNull();
    expect(headersOf(post).get("X-CSRF-Token")).toBe("csrf123");
    expect(headersOf(post).get("Content-Type")).toBe("application/json");
    expect(headersOf(get).get("X-Org-Id")).toBe("7");
    expect(headersOf(post).get("X-Org-Id")).toBe("7");
    expect((post[1] as RequestInit).credentials).toBe("include");
  });

  it("does not send X-Org-Id to auth endpoints", async () => {
    fetchMock.mockResolvedValue(jsonRes(200, ME));
    await api.auth.me();
    expect(headersOf(fetchMock.mock.calls[0]).get("X-Org-Id")).toBeNull();
  });

  it("throws a typed ApiError from the error envelope", async () => {
    fetchMock.mockResolvedValue(jsonRes(409, { detail: "Email taken", code: "email_taken" }));
    const err = await api.auth.register({ email: "a@b.co", password: "x", full_name: "A" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "email_taken", detail: "Email taken" });
  });

  it("does not attempt a refresh when login returns 401", async () => {
    fetchMock.mockResolvedValue(jsonRes(401, { detail: "Bad", code: "invalid_credentials" }));
    await expect(api.auth.login({ email: "a@b.co", password: "x" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(navigation.toLogin).not.toHaveBeenCalled();
  });

  it("single-flights refresh across concurrent 401s and retries each request once", async () => {
    let refreshCalls = 0;
    const retried = new Set<string>();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/refresh") {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return jsonRes(200, ME);
      }
      if (!retried.has(url)) {
        retried.add(url);
        return jsonRes(401, { detail: "expired", code: "token_expired" });
      }
      return jsonRes(200, [{ ok: url }]);
    });

    const [a, b] = await Promise.all([api.roles.list(), api.candidates.list()]);
    expect(a).toEqual([{ ok: "/api/roles/" }]);
    expect(b).toEqual([{ ok: "/api/candidates/" }]);
    expect(refreshCalls).toBe(1);
    // 2 originals + 1 refresh + 2 retries
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(navigation.toLogin).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.email).toBe("a@b.co");
  });

  it("redirects to login and clears the session when refresh fails", async () => {
    useAuthStore.setState({ user: ME.user, orgs: ME.orgs, currentOrgId: 7 });
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/auth/refresh"
        ? jsonRes(401, { detail: "nope", code: "invalid_token" })
        : jsonRes(401, { detail: "expired", code: "token_expired" }),
    );
    await expect(api.roles.list()).rejects.toBeInstanceOf(ApiError);
    expect(navigation.toLogin).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    // original + refresh only: no retry after a failed refresh
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes /auth/me on 401 (expired access token on first load)", async () => {
    let first = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/refresh") return jsonRes(200, ME);
      if (first) {
        first = false;
        return jsonRes(401, { detail: "expired", code: "token_expired" });
      }
      return jsonRes(200, ME);
    });
    await expect(api.auth.me()).resolves.toEqual(ME);
  });
});
