"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createClient, isSupabaseConfigured } from "../../lib/supabase/client";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: "github" | "google" | "demo";
  role?: string;
}

interface AuthContextValue {
  user: PlatformUser | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithProvider: (provider: "github" | "google") => Promise<void>;
  signInDemo: (role?: "developer" | "architect") => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEMO_DEVELOPER: PlatformUser = {
  id: "usr_demo_dev_01",
  email: "anurag@anvilmark.dev",
  name: "Anurag Dev",
  avatarUrl:
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
  provider: "demo",
  role: "Core Systems Engineer",
};

const DEMO_ARCHITECT: PlatformUser = {
  id: "usr_demo_arch_02",
  email: "lead.architect@atlasbank.internal",
  name: "Aaradhya Lead",
  avatarUrl:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
  provider: "demo",
  role: "Lead Architect",
};

const DEMO_USERS: Record<"developer" | "architect", PlatformUser> = {
  developer: DEMO_DEVELOPER,
  architect: DEMO_ARCHITECT,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  const syncUserFromSupabase = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      // Check local storage for demo user
      const stored = localStorage.getItem("anvilmark_demo_user");
      if (stored) {
        try {
          setUser(JSON.parse(stored));
        } catch {
          localStorage.removeItem("anvilmark_demo_user");
        }
      }
      setLoading(false);
      return;
    }

    try {
      // Handle OAuth redirect code fallback if URL has ?code= parameter
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get("code");
        if (code) {
          try {
            const { data, error } =
              await supabase.auth.exchangeCodeForSession(code);
            if (!error && data?.session?.user) {
              urlParams.delete("code");
              const next =
                urlParams.get("next") ||
                (window.location.pathname === "/" ||
                window.location.pathname === "/login"
                  ? "/dashboard"
                  : window.location.pathname);
              urlParams.delete("next");
              const newSearch = urlParams.toString();
              const newUrl =
                next +
                (newSearch ? `?${newSearch}` : "") +
                window.location.hash;
              window.history.replaceState({}, document.title, newUrl);
              if (
                window.location.pathname === "/" ||
                window.location.pathname === "/login"
              ) {
                window.location.href = newUrl;
                return;
              }
            }
          } catch (exchangeErr) {
            console.warn("Client-side code exchange note:", exchangeErr);
          }
        }
      }

      const {
        data: { user: sbUser },
      } = await supabase.auth.getUser();

      if (sbUser) {
        const userName =
          sbUser.user_metadata?.full_name ||
          sbUser.user_metadata?.name ||
          sbUser.user_metadata?.user_name ||
          sbUser.email?.split("@")[0] ||
          "Engineer";
        const userAvatar =
          sbUser.user_metadata?.avatar_url || sbUser.user_metadata?.picture;

        setUser({
          id: sbUser.id,
          email: sbUser.email ?? "unknown@user.com",
          name: userName,
          avatarUrl: userAvatar,
          provider:
            (sbUser.app_metadata?.provider as "github" | "google") || "github",
        });

        // Ensure user profile exists in database
        supabase
          .from("profiles")
          .upsert(
            {
              id: sbUser.id,
              email: sbUser.email,
              name: userName,
              avatar_url: userAvatar,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          )
          .then(() => {});
      } else {
        const stored = localStorage.getItem("anvilmark_demo_user");
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            localStorage.removeItem("anvilmark_demo_user");
          }
        } else {
          setUser(null);
        }
      }
    } catch (err) {
      console.error("Failed to sync Supabase user:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    syncUserFromSupabase();

    const supabase = createClient();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const sbUser = session.user;
        const userName =
          sbUser.user_metadata?.full_name ||
          sbUser.user_metadata?.name ||
          sbUser.user_metadata?.user_name ||
          sbUser.email?.split("@")[0] ||
          "Engineer";
        const userAvatar =
          sbUser.user_metadata?.avatar_url || sbUser.user_metadata?.picture;

        setUser({
          id: sbUser.id,
          email: sbUser.email ?? "unknown@user.com",
          name: userName,
          avatarUrl: userAvatar,
          provider:
            (sbUser.app_metadata?.provider as "github" | "google") || "github",
        });
        localStorage.removeItem("anvilmark_demo_user");
      } else {
        const stored = localStorage.getItem("anvilmark_demo_user");
        if (stored) {
          try {
            setUser(JSON.parse(stored));
          } catch {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [syncUserFromSupabase]);

  const signInWithProvider = async (provider: "github" | "google") => {
    const supabase = createClient();
    if (!supabase) {
      // If keys are not set up yet, fallback to demo developer
      signInDemo("developer");
      return;
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) {
      console.error("Supabase signInWithOAuth error:", error);
      throw error;
    }

    if (data?.url && typeof window !== "undefined") {
      window.location.href = data.url;
    }
  };

  const signInDemo = (role: "developer" | "architect" = "developer") => {
    const demoUser = DEMO_USERS[role] ?? DEMO_DEVELOPER;
    localStorage.setItem("anvilmark_demo_user", JSON.stringify(demoUser));
    setUser(demoUser);
  };

  const signOut = async () => {
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem("anvilmark_demo_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isConfigured: configured,
        signInWithProvider,
        signInDemo,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

const DEFAULT_AUTH_CONTEXT: AuthContextValue = {
  user: null,
  loading: false,
  isConfigured: false,
  signInWithProvider: async () => {},
  signInDemo: () => {},
  signOut: async () => {},
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  return context ?? DEFAULT_AUTH_CONTEXT;
}
