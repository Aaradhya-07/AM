"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "../../lib/supabase/client";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: "github" | "google" | "email";
}

interface AuthContextValue {
  user: PlatformUser | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithProvider: (
    provider: "github" | "google",
    next?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function platformUser(user: User): PlatformUser {
  const provider = user.app_metadata.provider;
  return {
    id: user.id,
    email: user.email ?? "",
    name:
      user.user_metadata.full_name ||
      user.user_metadata.name ||
      user.user_metadata.user_name ||
      user.email?.split("@")[0] ||
      "Engineer",
    avatarUrl: user.user_metadata.avatar_url || user.user_metadata.picture,
    provider:
      provider === "google" || provider === "github" ? provider : "email",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    try {
      localStorage.removeItem("anvilmark_demo_user");
    } catch {
      // Auth can still load when the browser blocks local storage.
    }
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    let authChanged = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      authChanged = true;
      setUser(session?.user ? platformUser(session.user) : null);
      setLoading(false);
    });

    async function loadUser() {
      if (!supabase) return;
      try {
        const {
          data: { user: account },
        } = await supabase.auth.getUser();
        if (!active || authChanged) return;
        const profile = account ? platformUser(account) : null;
        setUser(profile);
        if (profile && account) {
          void supabase
            .from("profiles")
            .upsert(
              {
                id: profile.id,
                email: account.email,
                name: profile.name,
                avatar_url: profile.avatarUrl,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            )
            .then(() => {});
        }
      } catch {
        if (active && !authChanged) setUser(null);
      } finally {
        if (active && !authChanged) setLoading(false);
      }
    }

    void loadUser();
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithProvider = async (
    provider: "github" | "google",
    next?: string,
  ) => {
    const supabase = createClient();
    if (!supabase) {
      throw new Error("Sign-in is unavailable. Supabase is not configured.");
    }

    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callback.href,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      console.error("Supabase signInWithOAuth error:", error);
      throw error;
    }

    if (data?.url && typeof window !== "undefined") {
      window.location.href = data.url;
    } else {
      throw new Error("The identity provider did not return a sign-in URL.");
    }
  };

  const signOut = async () => {
    const supabase = createClient();
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isConfigured: configured,
        signInWithProvider,
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
  signOut: async () => {},
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  return context ?? DEFAULT_AUTH_CONTEXT;
}
