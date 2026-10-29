import { readModelCatalog } from "../../../lib/model-catalog-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(readModelCatalog(), {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "The model catalog is unavailable. Refresh the catalog snapshot.",
      },
      { status: 503 },
    );
  }
}
