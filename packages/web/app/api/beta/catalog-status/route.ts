import { NextResponse } from "next/server";

import { getCatalogFreshness } from "../../../../lib/routing-catalog";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { ...getCatalogFreshness() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
