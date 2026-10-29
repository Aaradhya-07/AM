import { readArenaLeaderboard } from "../../../lib/arena-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    return Response.json(
      readArenaLeaderboard({
        config: params.get("config") ?? "",
        category: params.get("category") ?? "",
        query: params.get("q") ?? "",
        page: Number.isFinite(page) ? page : 1,
      }),
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "The Arena leaderboard snapshot is unavailable. Refresh the catalog snapshot.",
      },
      { status: 503 },
    );
  }
}
