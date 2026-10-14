// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../app/components/auth-provider";

const client = vi.hoisted(() => ({
  createClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: client.createClient,
  isSupabaseConfigured: client.isSupabaseConfigured,
}));

beforeEach(() => {
  client.createClient.mockReturnValue(null);
  client.isSupabaseConfigured.mockReturnValue(false);
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
    clear: () => items.clear(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("restores a verified session on mount and clears it on sign-out", async () => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  client.isSupabaseConfigured.mockReturnValue(true);
  client.createClient.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: "verified-user",
            email: "user@example.com",
            user_metadata: { name: "Verified User" },
            app_metadata: { provider: "github" },
          },
        },
      }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut,
    },
    from: vi
      .fn()
      .mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: null }) }),
  });

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let auth: ReturnType<typeof useAuth> | undefined;

  function Probe() {
    auth = useAuth();
    return null;
  }

  await act(async () => {
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });

  expect(auth?.loading).toBe(false);
  expect(auth?.user?.id).toBe("verified-user");
  await act(async () => {
    await auth?.signOut();
  });
  expect(signOut).toHaveBeenCalledOnce();
  expect(auth?.user).toBeNull();

  await act(async () => root.unmount());
});

describe("unconfigured sign-in", () => {
  it("does not restore a stale demo identity or accept provider sign-in", async () => {
    localStorage.setItem(
      "anvilmark_demo_user",
      JSON.stringify({ id: "fake-user", provider: "demo" }),
    );
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let auth: ReturnType<typeof useAuth> | undefined;

    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });

    expect(auth?.loading).toBe(false);
    expect(auth?.user).toBeNull();
    expect(localStorage.getItem("anvilmark_demo_user")).toBeNull();
    await expect(auth?.signInWithProvider("github")).rejects.toThrow(
      "Supabase is not configured",
    );

    await act(async () => root.unmount());
  });
});
