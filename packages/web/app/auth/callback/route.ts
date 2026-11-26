import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function safeNextPath(value: string | null, origin: string): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/dashboard";
  }
  try {
    const destination = new URL(value, origin);
    if (
      destination.origin === origin &&
      !/^\/(?:auth|login)(?:\/|$)/i.test(destination.pathname)
    ) {
      return destination.href;
    }
  } catch {
    // Use the default destination when the path is invalid.
  }
  return "/dashboard";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), origin);
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("Supabase OAuth provider error:", error, errorDescription);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(errorDescription || error)}`,
    );
  }

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);
      if (!exchangeError) {
        return NextResponse.redirect(new URL(next, origin), {
          headers: { "Cache-Control": "private, no-store" },
        });
      } else {
        console.error("Supabase exchange error:", exchangeError);
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`,
        );
      }
    }
  }

  // Return the user to an error page with instructions if exchange failed
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(code ? "Sign-in is not configured." : "No sign-in code was returned.")}`,
  );
}
