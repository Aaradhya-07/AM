import { NextResponse } from "next/server";

import { getSelfHostedPlannerAccess } from "../../../../lib/planner-access";
import { listSelfHostedModels } from "../../../../lib/self-hosted-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getSelfHostedPlannerAccess();
  const models = access ? await listSelfHostedModels(access.token) : [];
  return NextResponse.json(
    { configured: Boolean(access), models },
    { headers: { "Cache-Control": "no-store" } },
  );
}
