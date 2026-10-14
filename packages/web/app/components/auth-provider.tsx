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
  provider: "github" | "google";
}

interface AuthContextValue {
  user: PlatformUser | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithProvider: (provider: "github" | "google") => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isSupabaseConfigured();

  const syncUserFromSupabase = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
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
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to sync Supabase user:", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    localStorage.removeItem("anvilmark_demo_user");
    syncUserFromSupabase();

    const supabase = createClient();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
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
      } else {
        setUser(null);
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
      throw new Error("Sign-in is unavailable. Supabase is not configured.");
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
