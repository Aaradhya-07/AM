import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("../lib/supabase/server", () => ({ createClient: auth.createClient }));

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  vi.clearAllMocks();
});

describe("Supabase configuration", () => {
  it("rejects missing, placeholder, and malformed settings", async () => {
    const { getSupabaseConfig } = await import("../lib/supabase/config");
    expect(getSupabaseConfig()).toBeNull();

    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://your-project-ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "some-key";
    expect(getSupabaseConfig()).toBeNull();

    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";
    expect(getSupabaseConfig()).toBeNull();

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "your-anon-key";
    expect(getSupabaseConfig()).toBeNull();
  });

  it("accepts a valid HTTPS endpoint and a local Supabase endpoint", async () => {
    const { getSupabaseConfig } = await import("../lib/supabase/config");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-publishable-key";
    expect(getSupabaseConfig()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "test-publishable-key",
    });

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    expect(getSupabaseConfig()?.url).toBe("http://localhost:54321");
  });
});

describe("OAuth callback", () => {
  it("returns provider errors to the sign-in page", async () => {
    const { GET } = await import("../app/auth/callback/route");
    const response = await GET(
      new Request(
        "https://example.com/auth/callback?error=access_denied&error_description=Try+again",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://example.com/login?error=Try%20again",
    );
    expect(auth.createClient).not.toHaveBeenCalled();
  });

  it("exchanges the code once and redirects only within this site", async () => {
    const { GET } = await import("../app/auth/callback/route");
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: auth.exchangeCodeForSession },
    });

    const response = await GET(
      new Request("https://example.com/auth/callback?code=abc&next=%2Fstudio"),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("abc");
    expect(response.headers.get("location")).toBe("https://example.com/studio");

    const unsafe = await GET(
      new Request(
        "https://example.com/auth/callback?code=def&next=%2F%2Fevil.example",
      ),
    );
    expect(unsafe.headers.get("location")).toBe(
      "https://example.com/dashboard",
    );
  });

  it("shows exchange failures on the sign-in page", async () => {
    const { GET } = await import("../app/auth/callback/route");
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { message: "Code expired" },
    });
    auth.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: auth.exchangeCodeForSession },
    });
    const response = await GET(
      new Request("https://example.com/auth/callback?code=expired"),
    );
    expect(response.headers.get("location")).toBe(
      "https://example.com/login?error=Code%20expired",
    );
  });
});
