import { fetchHuggingFaceModelEvals } from "@anvilmark/adapters";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const modelId = request.nextUrl.searchParams.get("id") ?? "";
  if (
    !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(modelId) ||
    modelId.length > 200
  ) {
    return NextResponse.json(
      { error: "Use a Hugging Face publisher/model ID." },
      { status: 400 },
    );
  }
  try {
    const snapshot = await fetchHuggingFaceModelEvals(modelId);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Published evaluations could not be loaded for this model right now.",
      },
      { status: 502 },
    );
  }
}
