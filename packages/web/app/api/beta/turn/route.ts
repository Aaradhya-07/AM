import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BetaTurnRequest,
  TurnTriageSchema,
  type BetaTurnResponse,
  type ClarificationQuestionItem,
} from "../../../../lib/beta-turn";
import {
  PlanOutput,
  validatePlan,
  type PlanningInput,
} from "../../../../lib/planner";
import {
  resolveRoutingPool,
  type RoutableCandidate,
} from "../../../../lib/routing-catalog";
import { listSelfHostedModels } from "../../../../lib/self-hosted-models";

export const runtime = "nodejs";

const triageSystem = `You are AnvilMark, a sharp, pragmatic software architecture & model-routing assistant. Return ONE JSON object matching the supplied JSON Schema.

Choose "mode" using these strict rules:
1. "chat": The latest user message is a greeting, small talk, test phrase (e.g. "hi", "hello", "hello world", "hey"), thanks, or a meta question asking what you can do / how AnvilMark works, with NO active software project being specified yet.
   - "reply": Give a warm, natural, concise response (2-3 sentences max) explaining that AnvilMark helps turn rough ideas into concrete architecture decisions, ordered task slices, cost-optimal per-task model picks, and a ready-to-paste coding-agent prompt—then end by asking what they are planning to build today.
   - Set "questions": [] and "elevatedBrief": "".

2. "clarify": The user wants to build, change, or design software, BUT key requirements that materially change architecture are still missing or vague (e.g. "build a todo app", "create a dashboard", "make a chat app", "add authentication", or a short prompt lacking platform/stack, persistence/multi-user scope, privacy/deployment constraints, or scale).
   - IMPORTANT: Check prior assistant messages first. If you ALREADY asked clarifying questions and the user answered them (even briefly), DO NOT ask more questions—choose "plan" instead.
   - "reply": Briefly acknowledge what they want to build in natural language (1-2 sentences) and explain that locking a few quick choices first will prevent wrong architecture guesses. Do NOT propose architecture decisions or task lists yet.
   - "questions": Provide 2 to 4 tailored, concrete questions for THIS specific project. Each question must have 3-4 short clickable options, a brief "why" (how this choice changes architecture), and "allowMultiple" (true only when selecting multiple options makes sense).
   - Set "elevatedBrief": "".

3. "plan": Either (a) the user provided concrete requirements, stack/context, workflows, or constraints upfront, OR (b) the user answered previous clarifying questions, OR (c) an architecture plan was already discussed and the user is refining it.
   - "reply": Write a concise, insightful 2-3 sentence architectural summary explaining how you sharpened their brief (edge cases, data invariants, or model-routing efficiencies you incorporated).
   - "elevatedBrief": Upgrade and expand the user's requirements into a rigorous engineering specification covering target users, core workflows, edge cases, failure/retry invariants, data boundaries, and explicit non-goals.
   - Set "questions": [].`;

const planSystem = `You are AnvilMark's principal software architect and coding-model router. Return ONE JSON object matching the supplied JSON Schema.

Your job is to take the user's requirements and return BETTER, sharper engineering decisions than a generic summary:
- The actual repository is not attached: never claim to have inspected local files or executed tests. Mark repo-specific assumptions explicitly.
- Surface real-world edge cases (idempotency, validation boundaries, concurrency, failure recovery, auth/tenant isolation where relevant).
- Split work into ordered end-to-end vertical slices (keep simple changes to 1-2 tasks; larger builds 3-6 tasks) with accurate "dependsOn" task IDs.
- For each architecture decision, state the concrete requirement driving it, a credible alternative you rejected, and the honest tradeoff.
- MODEL ROUTING & COST OPTIMIZATION: Choose each task's "model" ONLY from the declared candidate model IDs. Match model tier to task risk and complexity so the user saves money without sacrificing quality:
  - Use "fast" / local OSS tier models for bounded schemas, migrations, types, straightforward CRUD/UI components, fixtures, and unit tests.
  - Use "balanced" tier models for multi-file feature slices, API integrations, and stateful UI flows.
  - Reserve expensive "frontier" tier models strictly for ambiguous architecture, security-critical auth/crypto boundaries, or tricky concurrency invariants.
  - In "why", cite both task scope/risk and cost/tier fit. If more than one candidate model is available, include 1-2 "alternatives" from OTHER declared candidate models (never repeat the task's chosen model in its own alternatives) with clear quality/cost tradeoffs.
- Estimate realistic single-attempt inputTokens and outputTokens (including assumed repository context) and state "estimateBasis".
- In Strict mode, include concrete defensive controls and verification steps in "security"; never describe unrun checks as passed.`;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function extractJsonText(raw: string): string {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, "")
    .trim();
  if (stripped.startsWith("{")) return stripped;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

function buildPlanSchema(
  candidateModels: string[],
  strict: boolean,
): Record<string, unknown> {
  const schema = z.toJSONSchema(PlanOutput) as Record<string, unknown>;
  const props = schema.properties as Record<string, Record<string, unknown>>;
  if (strict && props?.security) {
    props.security.minItems = 1;
  }
  const taskItems = props?.tasks?.items as
    { properties?: Record<string, Record<string, unknown>> } | undefined;
  const taskProps = taskItems?.properties;
  if (taskProps && candidateModels.length > 0) {
    taskProps.model = {
      type: "string",
      enum: candidateModels,
    };
    const alternativesItems = taskProps.alternatives?.items as
      { properties?: Record<string, Record<string, unknown>> } | undefined;
    if (alternativesItems?.properties) {
      alternativesItems.properties.model = {
        type: "string",
        enum: candidateModels,
      };
    }
    if (candidateModels.length > 1 && taskProps.alternatives) {
      taskProps.alternatives.minItems = 1;
    }
  }
  return schema;
}

function defaultClarificationQuestions(): ClarificationQuestionItem[] {
  return [
    {
      id: "platform-stack",
      question: "Where will this run and do you have a preferred stack?",
      why: "Determines runtime boundaries, framework conventions, and deployment setup.",
      options: [
        "Web app (Next.js / TypeScript)",
        "Backend API / CLI service",
        "Desktop or mobile app",
        "Pick the cleanest stack for me",
      ],
      allowMultiple: false,
    },
    {
      id: "data-persistence",
      question: "How should data and user accounts work in v1?",
      why: "Changes whether we need auth boundaries, database migrations, or local storage.",
      options: [
        "Single-user / local-first storage",
        "Shared database, no login yet",
        "Multi-user with authentication",
      ],
      allowMultiple: false,
    },
    {
      id: "v1-priority",
      question: "What matters most for the first working version?",
      why: "Shapes task slicing, edge-case depth, and verification rigor.",
      options: [
        "Lean MVP I can ship today",
        "Production-ready data & error handling",
        "Offline / local privacy guarantees",
      ],
      allowMultiple: true,
    },
  ];
}

async function callModelJson(params: {
  provider: "google" | "openai" | "configured";
  endpoint: string;
  model: string;
  key: string;
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<
  { ok: true; text: string } | { ok: false; status: number; error: string }
> {
  const instruction = `${params.systemPrompt}\nJSON Schema: ${JSON.stringify(params.schema)}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.provider === "google"
      ? { "x-goog-api-key": params.key }
      : params.key
        ? { Authorization: `Bearer ${params.key}` }
        : {}),
  };
  const baseOpenAiMessages = [
    { role: "system", content: instruction },
    { role: "user", content: params.userPrompt },
  ];
  const primaryBody =
    params.provider === "google"
      ? {
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: params.maxTokens,
          },
        }
      : params.provider === "openai"
        ? {
            model: params.model,
            messages: baseOpenAiMessages,
            response_format: { type: "json_object" },
            max_completion_tokens: params.maxTokens,
          }
        : {
            model: params.model,
            messages: baseOpenAiMessages,
            max_tokens: params.maxTokens,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: params.schemaName,
                strict: true,
                schema: params.schema,
              },
            },
            chat_template_kwargs: { enable_thinking: false },
          };

  const timeoutMs = params.provider === "configured" ? 240_000 : 90_000;
  try {
    let response = await fetch(params.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(primaryBody),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (
      params.provider === "configured" &&
      (response.status === 400 || response.status === 422)
    ) {
      response = await fetch(params.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: params.model,
          messages: baseOpenAiMessages,
          max_tokens: params.maxTokens,
        }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    }

    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          status: 429,
          error:
            "The provider is rate-limited or out of quota. Try again later or switch models.",
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: 502,
          error: "The provider rejected this key or model access.",
        };
      }
      return {
        ok: false,
        status: 502,
        error:
          "The provider refused the request. Check the selected model and endpoint configuration.",
      };
    }

    const payload = await response.json();
    const parts: unknown = payload.candidates?.[0]?.content?.parts;
    const content: unknown =
      params.provider === "google"
        ? Array.isArray(parts)
          ? parts
              .filter(
                (part) => !part?.thought && typeof part?.text === "string",
              )
              .map((part) => part.text)
              .join("")
          : undefined
        : payload.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.length > 160_000) {
      return {
        ok: false,
        status: 502,
        error: "The model did not return a readable response.",
      };
    }
    return { ok: true, text: extractJsonText(content) };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Could not reach the planner model or the request timed out.",
    };
  }
}

function repairPlanAlternatives(
  raw: unknown,
  candidates: readonly RoutableCandidate[],
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clone = structuredClone(raw) as {
    tasks?: Array<{
      model?: string;
      alternatives?: Array<{ model?: string; tradeoff?: string }>;
    }>;
  };
  if (!Array.isArray(clone.tasks)) return clone;
  const validIds = candidates.map((c) => c.model);
  if (validIds.length <= 1) return clone;

  for (const task of clone.tasks) {
    if (typeof task.model !== "string") continue;
    const seen = new Set<string>();
    const filtered = (Array.isArray(task.alternatives) ? task.alternatives : [])
      .filter((alt) => {
        if (
          !alt ||
          typeof alt.model !== "string" ||
          alt.model === task.model ||
          !validIds.includes(alt.model) ||
          seen.has(alt.model)
        ) {
          return false;
        }
        seen.add(alt.model);
        return true;
      })
      .slice(0, 2);

    if (filtered.length === 0) {
      const fallback = candidates.find((c) => c.model !== task.model);
      if (fallback) {
        filtered.push({
          model: fallback.model,
          tradeoff:
            fallback.tier === "frontier"
              ? "Higher-cost frontier alternative if unexpected architectural ambiguity arises."
              : "Lower-cost alternative if the implementation scope stays straightforward.",
        });
      }
    }
    task.alternatives = filtered;
  }
  return clone;
}

const effortGuidance = {
  low: "Keep the plan lean and focused on the fastest safe path to a working v1.",
  medium:
    "Cover core architectural decisions, realistic edge cases, and verification checks.",
  max: "Deeply analyze edge cases, concurrency/failure invariants, security boundaries, and architectural tradeoffs.",
} as const;

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError("Open AnvilMark directly to submit a request.", 403);
  }
  const reader = request.body?.getReader();
  if (!reader) return jsonError("Provide a conversation request.", 400);

  let body = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 96 * 1024) {
        await reader.cancel();
        return jsonError("Conversation request is too large.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    return jsonError("Could not read the conversation request.", 400);
  }

  const parsed = BetaTurnRequest.safeParse(
    await Promise.resolve()
      .then(() => JSON.parse(body))
      .catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(
      "Check your message length, selected model ID, and configuration.",
      400,
    );
  }

  const {
    messages,
    effort,
    strict,
    forcePlan = false,
    provider,
    model,
    key: suppliedKey,
    routingPrefs,
  } = parsed.data;

  const key =
    suppliedKey ||
    (provider === "google"
      ? (process.env.ANVILMARK_GEMINI_API_KEY?.trim() ?? "")
      : provider === "openai"
        ? (process.env.ANVILMARK_OPENAI_API_KEY?.trim() ?? "")
        : "");

  const endpoint =
    provider === "configured"
      ? process.env.ANVILMARK_PLANNER_ENDPOINT?.trim()
      : provider === "google"
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : "https://api.openai.com/v1/chat/completions";

  if (!endpoint) {
    return jsonError(
      "A self-hosted endpoint has not been configured on this web server.",
      503,
    );
  }
  if (!key && provider !== "configured") {
    return jsonError("Enter your provider API key.", 400);
  }

  let elevatedBrief = "";
  let architectReply =
    "Here is the sharpened architecture, task split, and per-task model routing based on your brief.";

  if (!forcePlan) {
    const triageSchema = z.toJSONSchema(TurnTriageSchema) as Record<
      string,
      unknown
    >;
    const triageResult = await callModelJson({
      provider,
      endpoint,
      model,
      key,
      systemPrompt: triageSystem,
      userPrompt: JSON.stringify({ conversation: messages }),
      schemaName: "anvilmark_turn_triage",
      schema: triageSchema,
      maxTokens: 1600,
    });

    if (!triageResult.ok) {
      return jsonError(triageResult.error, triageResult.status);
    }

    let triage;
    try {
      triage = TurnTriageSchema.parse(JSON.parse(triageResult.text));
    } catch {
      return jsonError(
        "The model returned an unreadable reply. Try sending your message again or switching models.",
        502,
      );
    }

    if (triage.mode === "chat") {
      const payload: BetaTurnResponse = {
        mode: "chat",
        reply: triage.reply,
      };
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (triage.mode === "clarify") {
      const payload: BetaTurnResponse = {
        mode: "clarify",
        reply: triage.reply,
        questions:
          triage.questions.length > 0
            ? triage.questions
            : defaultClarificationQuestions(),
      };
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    elevatedBrief = triage.elevatedBrief;
    architectReply = triage.reply;
  }

  const selfHosted =
    routingPrefs.subscriptions.includes("local_oss") ||
    routingPrefs.mode === "open"
      ? await listSelfHostedModels()
      : [];
  const routingSnapshot = resolveRoutingPool(routingPrefs, selfHosted);
  const candidates = routingSnapshot.candidates;

  const userMessages = messages.filter((m) => m.role === "user");
  const rawIdea =
    elevatedBrief.trim().length >= 10
      ? elevatedBrief.trim()
      : userMessages.map((m) => m.content).join("\n\n");
  const idea =
    rawIdea.length >= 10
      ? rawIdea.slice(0, 12000)
      : `${rawIdea} — software implementation plan`;

  const transcriptContext = [
    `Planning depth: ${effortGuidance[effort]}`,
    `Routing mode: ${routingPrefs.mode === "open" ? "Open best-fit across ecosystem" : `User subscriptions (${routingPrefs.subscriptions.join(", ")})`}`,
    `Conversation transcript:\n${messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n")}`,
  ]
    .join("\n\n")
    .slice(0, 8000);

  const plannerInput: PlanningInput = {
    idea,
    context: transcriptContext,
    strict,
    provider,
    model,
    key,
    candidates: candidates.map((c) => ({
      model: c.model,
      billing: c.billing,
      notes: `${c.tier.toUpperCase()} tier · ${c.strengths}`.slice(0, 200),
    })),
  };

  const planSchema = buildPlanSchema(
    candidates.map((c) => c.model),
    strict,
  );
  const planUserPrompt = JSON.stringify({
    idea: plannerInput.idea,
    context: plannerInput.context,
    strict,
    candidateModelsWithLatestEvidence: candidates.map((c) => ({
      model: c.model,
      label: c.label,
      provider: c.provider,
      tier: c.tier,
      billing: c.billing,
      inputUsdPerMillion: c.inputUsdPerMillion,
      outputUsdPerMillion: c.outputUsdPerMillion,
      arenaAgentRank: c.arenaAgentRank,
      arenaCodingScore: c.arenaCodingScore,
      strengths: c.strengths,
    })),
  });

  const planResult = await callModelJson({
    provider,
    endpoint,
    model,
    key,
    systemPrompt: planSystem,
    userPrompt: planUserPrompt,
    schemaName: "anvilmark_plan",
    schema: planSchema,
    maxTokens: 8000,
  });

  if (!planResult.ok) {
    return jsonError(planResult.error, planResult.status);
  }

  try {
    const rawParsed = repairPlanAlternatives(
      JSON.parse(planResult.text),
      candidates,
    );
    const plan = validatePlan(rawParsed, plannerInput);
    const payload: BetaTurnResponse = {
      mode: "plan",
      reply: architectReply,
      plan,
      candidates,
      catalogDate: routingSnapshot.fetchedAt,
      strict,
      request: { idea: plannerInput.idea, context: plannerInput.context },
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return jsonError(
      "The model returned an incomplete plan structure. Try regenerating or choosing a stronger planning model.",
      502,
    );
  }
}
