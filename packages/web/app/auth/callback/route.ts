import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function safeNextPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/dashboard";
  }
  if (value.startsWith("/auth/") || value.startsWith("/login")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
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
        return NextResponse.redirect(new URL(next, origin));
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
