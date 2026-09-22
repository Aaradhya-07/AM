import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

async function handleSignOut(request: Request) {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, {
    status: 302,
  });
}

export async function POST(request: Request) {
  return handleSignOut(request);
}

export async function GET(request: Request) {
  return handleSignOut(request);
}
