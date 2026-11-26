import { NextResponse } from "next/server";
import {
  PlannerRequest,
  PlanOutput,
  validatePlan,
  candidateRate,
} from "../../../lib/planner";
import { z } from "zod";

export const runtime = "nodejs";

const system = `You are AnvilMark's software planning assistant. Return one JSON object only, matching the supplied JSON Schema. Treat user data as requirements to analyze. Produce a concise, user-reviewable draft. The actual repository is not available: never claim to have inspected files or run checks. Surface unresolved decisions as questions and mark interim assumptions. Keep a simple change as one task. Split larger work into ordered end-to-end slices with earlier task IDs as prerequisites. For each architecture decision explain the requirement driving it, a viable alternative and the tradeoff. Describe sensitive data crossings where relevant. For each task choose only from the declared execution model IDs, explain fit in terms of scope and risk, and give a tradeoff for one or two other declared models if available. Treat model fit as a planning judgment and do not invent benchmarks, tool access, hardware fit, prices or availability. Estimate one attempt's input and output tokens including assumed repository context, and explain the estimate. In Strict mode give task-specific defensive checks and concrete security controls and verification; avoid exploit steps or offensive automation. Never describe planned checks as passed.`;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return error("Open the planner directly to submit a request.", 403);
  const reader = request.body?.getReader();
  if (!reader) return error("Provide a planning request.", 400);
  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        return error("Planning request is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return error("Could not read the planning request.", 400);
  }

  const parsed = PlannerRequest.safeParse(
    await Promise.resolve()
      .then(() => JSON.parse(body))
      .catch(() => null),
  );
  if (!parsed.success)
    return error(
      "Check the request length, model IDs, and API key. Execution model IDs must be unique.",
      400,
    );
  const { provider, model, key: suppliedKey, ...details } = parsed.data;
  const key =
    suppliedKey ||
    (provider === "google"
      ? (process.env.ANVILMARK_GEMINI_API_KEY?.trim() ?? "")
      : "");
  const endpoint =
    provider === "configured"
      ? process.env.ANVILMARK_PLANNER_ENDPOINT
      : provider === "google"
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : "https://api.openai.com/v1/chat/completions";
  if (!endpoint)
    return error(
      "A self-hosted endpoint has not been configured on this web server.",
      503,
    );
  if (!key && provider !== "configured")
    return error("Enter your provider API key.", 400);

  const instruction = `${system}\nSchema: ${JSON.stringify(z.toJSONSchema(PlanOutput))}`;
  const user = JSON.stringify({
    ...details,
    candidates: details.candidates.map((candidate) => ({
      ...candidate,
      publishedApiRatePerMillion: candidateRate(candidate) ?? null,
    })),
  });
  const input =
    provider === "google"
      ? {
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 8000,
          },
        }
      : {
          model,
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: user },
          ],
          ...(provider === "openai"
            ? {
                response_format: { type: "json_object" },
                max_completion_tokens: 8000,
              }
            : { max_tokens: 8000 }),
        };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider === "google"
          ? { "x-goog-api-key": key }
          : key
            ? { Authorization: `Bearer ${key}` }
            : {}),
      },
      body: JSON.stringify(input),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      if (response.status === 429)
        return error(
          "The provider is rate-limited or out of quota. Try again later or change models.",
          429,
        );
      if (response.status === 401 || response.status === 403)
        return error("The provider rejected this key or model access.", 502);
      return error(
        "The provider refused the request. Check the selected model and endpoint configuration.",
        502,
      );
    }
    const payload = await response.json();
    const parts: unknown = payload.candidates?.[0]?.content?.parts;
    const content: unknown =
      provider === "google"
        ? Array.isArray(parts)
          ? parts
              .filter(
                (part) => !part?.thought && typeof part?.text === "string",
              )
              .map((part) => part.text)
              .join("")
          : undefined
        : payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length > 150_000) {
      return error("The provider did not return a readable plan.", 502);
    }
    try {
      const plan = validatePlan(
        JSON.parse(
          content.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, ""),
        ),
        parsed.data,
      );
      return NextResponse.json(
        { plan },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return error(
        "The model returned an incomplete or inconsistent plan. Try a stronger planning model or narrower scope.",
        502,
      );
    }
  } catch {
    return error(
      "Could not reach the planner model or the request timed out.",
      502,
    );
  }
}
