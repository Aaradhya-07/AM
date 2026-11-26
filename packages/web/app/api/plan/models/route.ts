import { NextResponse } from "next/server";

import { listSelfHostedModels } from "../../../../lib/self-hosted-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(process.env.ANVILMARK_PLANNER_ENDPOINT?.trim());
  const models = configured ? await listSelfHostedModels() : [];
  return NextResponse.json(
    { configured, models },
    { headers: { "Cache-Control": "no-store" } },
  );
}
