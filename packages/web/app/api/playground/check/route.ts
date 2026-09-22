import { NextResponse } from "next/server";

import {
  AtlasAnalysisError,
  checkAtlasPermutation,
  type AtlasDataChoice,
  type AtlasModelChoice,
} from "../../../../lib/atlas-checker";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const model = body?.model;
    const dataHandling = body?.dataHandling;

    if (model !== "selected" && model !== "different" && model !== "dynamic") {
      return NextResponse.json(
        { error: "Invalid model selection" },
        { status: 400 },
      );
    }

    if (dataHandling !== "redacted" && dataHandling !== "raw") {
      return NextResponse.json(
        { error: "Invalid data handling selection" },
        { status: 400 },
      );
    }

    const result = await checkAtlasPermutation({
      model: model as AtlasModelChoice,
      dataHandling: dataHandling as AtlasDataChoice,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AtlasAnalysisError) {
      return NextResponse.json(
        { error: "analysis_failed", analysisErrors: error.analysisErrors },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}
