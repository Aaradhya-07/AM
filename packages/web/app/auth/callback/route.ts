import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";
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
        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalEnv = process.env.NODE_ENV === "development";
        if (isLocalEnv) {
          return NextResponse.redirect(`${origin}${next}`);
        } else if (forwardedHost) {
          const host = (forwardedHost.split(",")[0] ?? "").trim();
          return NextResponse.redirect(`https://${host}${next}`);
        } else {
          return NextResponse.redirect(`${origin}${next}`);
        }
      } else {
        console.error("Supabase exchange error:", exchangeError);
        return NextResponse.redirect(
          `${origin}/login?error=${encodeURIComponent(exchangeError.message)}`,
        );
      }
    }
  }

  // Return the user to an error page with instructions if exchange failed
  return NextResponse.redirect(`${origin}/login?error=auth_exchange_failed`);
}
