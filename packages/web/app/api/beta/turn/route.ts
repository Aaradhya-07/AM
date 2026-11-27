import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BetaTurnRequest,
  TurnTriageSchema,
  detectPlanProgressSection,
  formatRepoContextPromptSection,
  type BetaAttachment,
  type BetaTurnProgressSection,
  type BetaTurnResponse,
  type ClarificationQuestionItem,
  type RepoContextSnapshot,
  type RepoOutcomesSummary,
} from "../../../../lib/beta-turn";
import { formatOutcomesPromptSection } from "../../../../lib/outcome-priors";
import { getSelfHostedPlannerAccess } from "../../../../lib/planner-access";
import {
  PlanOutput,
  projectScales,
  sliceComplexities,
  sliceKinds,
  validatePlan,
  type PlanningInput,
} from "../../../../lib/planner";
import {
  resolveRoutingPool,
  type QuotaMode,
} from "../../../../lib/routing-catalog";
import {
  listSelfHostedModels,
  type SelfHostedModel,
} from "../../../../lib/self-hosted-models";
import { compileSliceContractForTask } from "../../../../lib/slice-contracts";
import { calibratePlanRouting } from "../../../../lib/slice-router";
import {
  buildMatchedPlanExemplarPrompt,
  buildMatchedTriageExemplarPrompt,
} from "../../../../lib/oss-exemplars";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const PROGRESS_CHAR_STEP = 250;

const triageSystemBase = `You are AnvilMark, a sharp, pragmatic software architecture & model-routing assistant. Return ONE JSON object matching the supplied JSON Schema.

Choose "mode" using these strict rules:
1. "chat": The latest user message is a greeting, small talk, test phrase (e.g. "hi", "hello", "hello world", "hey"), thanks, or a meta question asking what you can do / how AnvilMark works, with NO active software project being specified yet.
   - "reply": Give a warm, natural, concise response (2-3 sentences max) explaining that AnvilMark helps turn rough ideas into concrete architecture decisions, right-sized vertical slices, two calibrated model choices per slice, and a ready-to-paste coding-agent prompt—then end by asking what they are planning to build today.
   - Set "questions": [] and "elevatedBrief": "".

2. "clarify": The user wants to build, change, or design software, BUT high-leverage product or boundary choices that materially change the data model, workflows, or architecture are still missing (e.g. "build a todo app", "create a dashboard", "make a chat app", "add webhooks").
   - IMPORTANT: Check prior assistant messages first. If you ALREADY asked clarifying questions and the user answered them (even briefly or by skipping to defaults), DO NOT ask more questions—choose "plan" instead.
   - "reply": Briefly acknowledge what they want to build in 1-2 natural sentences and explain why locking these specific product/architecture choices first avoids wrong assumptions. Do NOT output task lists yet.
   - QUESTION QUALITY RULES ("questions": 2 to 4 tailored questions):
     - Ask DOMAIN-SPECIFIC workflow & boundary questions tailored to THIS exact idea (e.g. for a todo app: collaboration/sync scope & task workflow depth like recurring/reminders/offline; for imports/webhooks: duplicate/conflict handling & volume; for dashboards: live push vs. polling & operator actions). Never fall back to generic filler if stack or scope is already stated.
     - Put the most pragmatic recommended v1 choice FIRST in each question's 3-4 clickable "options", keep options concrete and mutually distinct, write a sharp 1-line "why" explaining the architectural fork, and set "allowMultiple": true only when combining choices makes sense.
   - Set "elevatedBrief": "".

3. "plan": Either (a) the user provided concrete requirements, stack/context, workflows, or constraints upfront, OR (b) the user answered previous clarifying questions, OR (c) an architecture plan was already discussed and the user is refining it.
   - "reply": Write a concise, insightful 2-3 sentence architectural summary explaining the key decisions, slice structure, and quality-aware model routing you prepared.
   - PROPORTIONAL BRIEF RULE ("elevatedBrief"):
     - Start with "Project scale: micro | small_app | multi_feature | complex_system."
     - Keep complexity STRICTLY proportional to what the user actually asked to build:
       - For micro changes or small single-entity apps (e.g. a personal todo app, simple CLI, or single endpoint), write a crisp, grounded specification covering clean data validation, UX states, and explicit non-goals—DO NOT invent enterprise queues, distributed locks, or multi-tenant infrastructure they did not ask for.
       - For multi-feature products or complex systems, enumerate EVERY distinct domain entity, user workflow, external integration, trust boundary, and failure/retry invariant so downstream planning decomposes all real capabilities instead of collapsing them into 3 generic buckets.
   - Set "questions": [].`;

const sharedSliceAndRoutingRules = `- VERTICAL SLICE DECOMPOSITION (NEVER DEFAULT TO A LAZY 3-SLICE TEMPLATE):
  - Set "projectScale" ("micro" | "small_app" | "multi_feature" | "complex_system") honestly first.
  - FORBIDDEN ANTI-PATTERN: Do NOT reflexively output 3 horizontal buckets ("1. Database/Backend, 2. Frontend UI, 3. Tests"). Decompose by shippable vertical capability (each slice delivers a cohesive feature slice with its own route/logic/UI/checks; extract a shared foundation/schema slice first only when multiple downstream slices depend on it).
  - Match slice count to ACTUAL architectural surface area and planning depth:
    - "micro" (bugfix, single endpoint, isolated refactor, config/CLI tweak): 1-2 slices.
    - "small_app" (focused single-entity app like a solo todo app, calculator, or single-view tool): 2-4 slices (2 on low effort; 3-4 when filters, persistence, or import/export warrant distinct vertical cuts).
    - "multi_feature" (multi-entity app with auth, relational DB, multiple user workflows, imports/webhooks, stateful UI): 5-8 slices structured as a real DAG ("dependsOn" listing only true prerequisites so independent slices can run in parallel waves).
    - "complex_system" (multi-role SaaS, real-time sync, payments/RBAC, multi-package monorepo, or max-effort architecture): 7-12 slices across parallelizable waves.
- QUALITY-MINDFUL 2-OPTION MODEL ROUTING:
  - Tag every task's "kind" ("schema_types" | "crud_ui" | "feature_integration" | "auth_security" | "concurrency_algorithms" | "tests_docs") and "complexity" ("trivial" | "low" | "medium" | "high") BEFORE choosing "model".
  - Choose "model" (Option 1: Recommended) and 1-2 "alternatives" (Option 2: Curated runner-up) ONLY from declared candidate model IDs.
  - Protect BOTH work quality and token spend—no arbitrary cap on frontier models, and never starve real features with weak models:
    - Use "frontier" tier models mindfully wherever "complexity" is "high" (ambiguous architecture, security/auth/tenancy boundaries, tricky concurrency or state invariants—as many slices as genuinely need frontier reasoning). NEVER waste heavy specialists like gpt-6-astra on routine CRUD, schemas, or simple apps like a todo list.
    - Use strong "balanced" workhorses (e.g. Claude Sonnet 5.5, GPT-6.1 Sol, Qwen 3 Coder 30B) as the backbone for real UI, CRUD, multi-file feature integrations, and stateful workflows so code quality stays high.
    - Reserve "fast" tier models strictly for genuinely narrow, mechanical slices (isolated schemas/types, config wiring, fixtures, straightforward unit tests) where quality will not drop.
    - Make the first entry in "alternatives" a genuinely useful second choice for the user (e.g. a quality step-up tier if scope grows, a zero-cost local OSS coder, or a leaner fast option on simple slices) with a concrete quality/cost "tradeoff".`;

const planSystemWithoutRepo = `You are AnvilMark's principal software architect and coding-model router. Return ONE JSON object matching the supplied JSON Schema.

Your job is to take the user's requirements and return BETTER, sharper engineering decisions than a generic summary:
- The actual repository is not attached: never claim to have inspected local files or executed tests. Mark repo-specific assumptions explicitly.
- Surface real-world edge cases proportionate to the project's scale (validation boundaries, error states, and—where genuinely relevant—idempotency, concurrency, or auth/tenant isolation).
- For each architecture decision, state the concrete requirement driving it, a credible alternative you rejected, and the honest tradeoff.
${sharedSliceAndRoutingRules}
- Estimate realistic single-attempt inputTokens and outputTokens (including assumed repository context) and state "estimateBasis".
- In Strict mode, include concrete defensive controls and verification steps in "security"; never describe unrun checks as passed.`;

const planSystemWithRepo = `You are AnvilMark's principal software architect and coding-model router. Return ONE JSON object matching the supplied JSON Schema.

Your job is to take the user's requirements and return BETTER, sharper engineering decisions than a generic summary:
- Verified local repository metadata (package scripts, checkCommands, frameworks, ADR paths, and tracked sampleFiles) is provided in the prompt. Reference those real checkCommands and existing paths in task checks, architecture decisions, and scope rather than guessing nonexistent commands or paths.
- IMPORTANT TRUTH RULE: Only structural repository metadata was exported—raw file contents were NOT read and no checks or tests have been executed. Never claim to have read file contents or run tests; mark implementation-detail assumptions explicitly.
- Surface real-world edge cases proportionate to the project's scale (validation boundaries, error states, and—where genuinely relevant—idempotency, concurrency, or auth/tenant isolation).
- For each architecture decision, state the concrete requirement driving it, a credible alternative you rejected, and the honest tradeoff.
${sharedSliceAndRoutingRules}
- Estimate realistic single-attempt inputTokens and outputTokens (including assumed repository context) and state "estimateBasis".
- In Strict mode, include concrete defensive controls and verification steps in "security"; never describe unrun checks as passed.`;

function buildTriageSystem(repoContext?: RepoContextSnapshot): string {
  if (!repoContext) return triageSystemBase;
  return `${triageSystemBase}

Verified local repository metadata is attached (repoName, languages, frameworks, packageManager, scripts, checkCommands, adrPaths, and tracked sampleFiles):
- Use the verified stack, frameworks, scripts, and checkCommands so you do not ask redundant questions about stack or repo tooling.
- Reference real checkCommands and existing paths in your reply and elevatedBrief rather than guessing.
- IMPORTANT: Only structural metadata was exported—raw file contents were NOT read and no commands were executed. Never claim to have inspected file contents or run checks.`;
}

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

function selectWarmTriageModel(
  selectedModel: string,
  selfHostedModels: readonly SelfHostedModel[],
): string {
  const selectedEntry = selfHostedModels.find((m) => m.id === selectedModel);
  if (selectedEntry?.status === "loaded") {
    return selectedModel;
  }
  const loadedModels = selfHostedModels.filter((m) => m.status === "loaded");
  if (loadedModels.length === 0) {
    return selectedModel;
  }
  const preferredWarm = loadedModels.find(
    (m) => m.id.toLowerCase() === "qwen3.5-9b",
  );
  return preferredWarm ? preferredWarm.id : loadedModels[0]!.id;
}

function buildPlanSchema(
  candidateModels: string[],
  strict: boolean,
): Record<string, unknown> {
  const schema = z.toJSONSchema(PlanOutput) as Record<string, unknown>;
  const props = schema.properties as Record<string, Record<string, unknown>>;
  if (props) {
    props.projectScale = {
      type: "string",
      enum: [...projectScales],
    };
  }
  if (Array.isArray(schema.required) && !schema.required.includes("projectScale")) {
    schema.required = [...schema.required, "projectScale"];
  }
  if (strict && props?.security) {
    props.security.minItems = 1;
  }
  const taskItems = props?.tasks?.items as
    | {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      }
    | undefined;
  const taskProps = taskItems?.properties;
  if (taskProps) {
    taskProps.kind = {
      type: "string",
      enum: [...sliceKinds],
    };
    taskProps.complexity = {
      type: "string",
      enum: [...sliceComplexities],
    };
    if (Array.isArray(taskItems?.required)) {
      const reqSet = new Set(taskItems.required);
      reqSet.add("kind");
      reqSet.add("complexity");
      taskItems.required = [...reqSet];
    }
  }
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

function appendAttachmentFallbackNote(
  userPrompt: string,
  attachments: readonly BetaAttachment[],
): string {
  const names = attachments
    .map((attachment) => `${attachment.name} (${attachment.mimeType})`)
    .join(", ");
  return `${userPrompt}\n\nNote: The user attached image files (${names}), which could not be sent visually because the selected self-hosted model rejected image input (likely a text-only model without vision mmproj). Acknowledge the attached filenames and base your response on the text requirements without claiming to have seen the images.`;
}

function buildOpenAiMessages(
  instruction: string,
  userPrompt: string,
  attachments: readonly BetaAttachment[],
  useVision: boolean,
) {
  if (attachments.length === 0) {
    return [
      { role: "system", content: instruction },
      { role: "user", content: userPrompt },
    ];
  }
  if (!useVision) {
    return [
      { role: "system", content: instruction },
      {
        role: "user",
        content: appendAttachmentFallbackNote(userPrompt, attachments),
      },
    ];
  }
  return [
    { role: "system", content: instruction },
    {
      role: "user",
      content: [
        { type: "text", text: userPrompt },
        ...attachments.map((attachment) => ({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        })),
      ],
    },
  ];
}

function buildGoogleParts(
  userPrompt: string,
  attachments: readonly BetaAttachment[],
) {
  if (attachments.length === 0) {
    return [{ text: userPrompt }];
  }
  return [
    { text: userPrompt },
    ...attachments.map((attachment) => ({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1),
      },
    })),
  ];
}

function combineTimeoutSignal(
  timeoutMs: number,
  requestSignal?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (requestSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([requestSignal, timeoutSignal]);
  }
  return timeoutSignal;
}

function mapUpstreamHttpError(status: number): {
  ok: false;
  status: number;
  error: string;
} {
  if (status === 429) {
    return {
      ok: false,
      status: 429,
      error:
        "The provider is rate-limited or out of quota. Try again later or switch models.",
    };
  }
  if (status === 401 || status === 403) {
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

async function parseJsonModelResponse(
  response: Response,
  provider: "google" | "openai" | "configured",
  onProgress?: (progress: {
    chars: number;
    section: BetaTurnProgressSection;
  }) => void,
): Promise<
  { ok: true; text: string } | { ok: false; status: number; error: string }
> {
  const payload = await response.json();
  const parts: unknown = payload.candidates?.[0]?.content?.parts;
  const content: unknown =
    provider === "google"
      ? Array.isArray(parts)
        ? parts
            .filter((part) => !part?.thought && typeof part?.text === "string")
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

  const text = extractJsonText(content);
  if (onProgress && text.length > 0) {
    onProgress({
      chars: text.length,
      section: detectPlanProgressSection(text),
    });
  }
  return { ok: true, text };
}

async function readOpenAiSseResponse(
  response: Response,
  onProgress?: (progress: {
    chars: number;
    section: BetaTurnProgressSection;
  }) => void,
): Promise<
  { ok: true; text: string } | { ok: false; status: number; error: string }
> {
  const reader = response.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      status: 502,
      error: "The model did not return a readable stream.",
    };
  }

  const decoder = new TextDecoder();
  let lineBuffer = "";
  let accumulated = "";
  let lastEmittedChars = 0;
  let lastEmittedSection: BetaTurnProgressSection = "overview";
  let doneSignal = false;

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(":") || !line.startsWith("data:")) return;
    const payloadStr = line.slice(5).trim();
    if (!payloadStr) return;
    if (payloadStr === "[DONE]") {
      doneSignal = true;
      return;
    }

    let chunk: unknown;
    try {
      chunk = JSON.parse(payloadStr);
    } catch {
      return;
    }

    const delta = (
      chunk as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      }
    )?.choices?.[0]?.delta?.content;

    if (typeof delta !== "string" || delta.length === 0) return;

    accumulated += delta;
    if (accumulated.length > 160_000) {
      throw new Error("STREAM_TOO_LARGE");
    }

    if (onProgress) {
      const section = detectPlanProgressSection(accumulated);
      if (
        section !== lastEmittedSection ||
        accumulated.length - lastEmittedChars >= PROGRESS_CHAR_STEP
      ) {
        lastEmittedChars = accumulated.length;
        lastEmittedSection = section;
        onProgress({ chars: accumulated.length, section });
      }
    }
  };

  try {
    while (!doneSignal) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
        if (doneSignal) break;
      }
    }
    lineBuffer += decoder.decode();
    if (!doneSignal && lineBuffer.trim()) {
      processLine(lineBuffer);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (err instanceof Error && err.message === "STREAM_TOO_LARGE") {
      return {
        ok: false,
        status: 502,
        error: "The model did not return a readable response.",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "Could not read streaming response from planner model.",
    };
  } finally {
    if (doneSignal) {
      await reader.cancel().catch(() => {});
    }
  }

  if (onProgress && lastEmittedChars === 0 && accumulated.length > 0) {
    onProgress({
      chars: accumulated.length,
      section: detectPlanProgressSection(accumulated),
    });
  }

  const text = extractJsonText(accumulated);
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: "The model did not return a readable response.",
    };
  }
  return { ok: true, text };
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
  attachments?: readonly BetaAttachment[] | undefined;
  skipVision?: boolean | undefined;
  stream?: boolean | undefined;
  onProgress?:
    | ((progress: { chars: number; section: BetaTurnProgressSection }) => void)
    | undefined;
  signal?: AbortSignal | undefined;
}): Promise<
  | { ok: true; text: string; usedTextOnlyFallback?: boolean }
  | { ok: false; status: number; error: string }
> {
  const instruction = `${params.systemPrompt}\nJSON Schema: ${JSON.stringify(params.schema)}`;
  const attachments = params.attachments ?? [];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(params.provider === "google"
      ? { "x-goog-api-key": params.key }
      : params.key
        ? { Authorization: `Bearer ${params.key}` }
        : {}),
  };

  const timeoutMs = params.provider === "configured" ? 240_000 : 90_000;
  const postUpstream = (body: Record<string, unknown>) =>
    fetch(params.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      signal: combineTimeoutSignal(timeoutMs, params.signal),
    });

  const buildConfiguredBody = (opts: {
    useVision: boolean;
    useSchema: boolean;
    useStream: boolean;
  }): Record<string, unknown> => {
    const messages = buildOpenAiMessages(
      instruction,
      params.userPrompt,
      attachments,
      opts.useVision,
    );
    if (!opts.useSchema) {
      return {
        model: params.model,
        messages,
        max_tokens: params.maxTokens,
        ...(opts.useStream ? { stream: true } : {}),
      };
    }
    return {
      model: params.model,
      messages,
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
      ...(opts.useStream ? { stream: true } : {}),
    };
  };

  const buildOpenAiBody = (useStream: boolean): Record<string, unknown> => ({
    model: params.model,
    messages: buildOpenAiMessages(
      instruction,
      params.userPrompt,
      attachments,
      true,
    ),
    response_format: { type: "json_object" },
    max_completion_tokens: params.maxTokens,
    ...(useStream ? { stream: true } : {}),
  });

  const readResponse = async (
    response: Response,
    expectStream: boolean,
  ): Promise<
    { ok: true; text: string } | { ok: false; status: number; error: string }
  > => {
    const contentType = response.headers.get("content-type") ?? "";
    if (
      expectStream &&
      contentType.toLowerCase().includes("text/event-stream")
    ) {
      return readOpenAiSseResponse(response, params.onProgress);
    }
    return parseJsonModelResponse(response, params.provider, params.onProgress);
  };

  try {
    if (params.provider === "google") {
      const response = await postUpstream({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [
          {
            role: "user",
            parts: buildGoogleParts(params.userPrompt, attachments),
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: params.maxTokens,
        },
      });
      if (!response.ok) return mapUpstreamHttpError(response.status);
      return await readResponse(response, false);
    }

    if (params.provider === "openai") {
      const wantStream = Boolean(params.stream);
      let response = await postUpstream(buildOpenAiBody(wantStream));
      if (wantStream && response.ok) {
        const streamed = await readResponse(response, true);
        if (streamed.ok) return streamed;
        // Stream failed midway: fall back to non-streaming.
        response = await postUpstream(buildOpenAiBody(false));
        if (!response.ok) return mapUpstreamHttpError(response.status);
        return await readResponse(response, false);
      }
      if (
        wantStream &&
        (response.status === 400 ||
          response.status === 422 ||
          response.status === 500 ||
          response.status === 501)
      ) {
        response = await postUpstream(buildOpenAiBody(false));
      }
      if (!response.ok) return mapUpstreamHttpError(response.status);
      return await readResponse(response, false);
    }

    // provider === "configured"
    const wantStream = Boolean(params.stream);
    let useVision = attachments.length > 0 && !params.skipVision;
    let usedTextOnlyFallback = Boolean(
      attachments.length > 0 && params.skipVision,
    );
    let useStream = wantStream;

    let response = await postUpstream(
      buildConfiguredBody({ useVision, useSchema: true, useStream }),
    );

    // Text-only GGUF fallback when configured server rejects image_url parts.
    if (
      useVision &&
      (response.status === 400 ||
        response.status === 422 ||
        response.status === 500)
    ) {
      useVision = false;
      usedTextOnlyFallback = true;
      response = await postUpstream(
        buildConfiguredBody({ useVision: false, useSchema: true, useStream }),
      );
    }

    // If streaming failed at HTTP level, fall back to non-streaming with json_schema.
    if (
      useStream &&
      (response.status === 400 ||
        response.status === 422 ||
        response.status === 500 ||
        response.status === 501)
    ) {
      useStream = false;
      response = await postUpstream(
        buildConfiguredBody({ useVision, useSchema: true, useStream: false }),
      );
    }

    // Legacy json_schema fallback for servers rejecting response_format.
    if (response.status === 400 || response.status === 422) {
      useStream = false;
      response = await postUpstream(
        buildConfiguredBody({ useVision, useSchema: false, useStream: false }),
      );
    }

    if (!response.ok) {
      return mapUpstreamHttpError(response.status);
    }

    const parsed = await readResponse(response, useStream);
    if (parsed.ok) {
      return {
        ...parsed,
        ...(usedTextOnlyFallback ? { usedTextOnlyFallback: true } : {}),
      };
    }

    // If stream reading failed midway, try one non-streaming fallback.
    if (useStream) {
      let fallbackResp = await postUpstream(
        buildConfiguredBody({ useVision, useSchema: true, useStream: false }),
      );
      if (fallbackResp.status === 400 || fallbackResp.status === 422) {
        fallbackResp = await postUpstream(
          buildConfiguredBody({
            useVision,
            useSchema: false,
            useStream: false,
          }),
        );
      }
      if (!fallbackResp.ok) return mapUpstreamHttpError(fallbackResp.status);
      const fallbackParsed = await readResponse(fallbackResp, false);
      if (fallbackParsed.ok) {
        return {
          ...fallbackParsed,
          ...(usedTextOnlyFallback ? { usedTextOnlyFallback: true } : {}),
        };
      }
      return fallbackParsed;
    }

    return parsed;
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Could not reach the planner model or the request timed out.",
    };
  }
}

const effortGuidance = {
  low: "Keep the plan lean with compact vertical slices (1-2 for micro changes, 2-3 for small apps, 3-5 for larger apps) focused on the fastest clean path to a working v1.",
  medium:
    "Decompose every distinct user workflow, data boundary, and integration into right-sized vertical slices (avoid collapsing multi-feature apps into just 3 slices) with concrete checks.",
  max: "Deeply analyze architectural tradeoffs, concurrency/security invariants, and parallelizable DAG waves—splitting multi-feature or complex builds into 6-12 granular vertical slices.",
} as const;

type TurnExecutionResult =
  | { ok: true; payload: BetaTurnResponse }
  | { ok: false; status: number; error: string };

type StreamEmitter = (event: string, data: unknown) => void;

async function executeTurn(
  params: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    effort: "low" | "medium" | "max";
    strict: boolean;
    forcePlan: boolean;
    provider: "google" | "openai" | "configured";
    model: string;
    key: string;
    endpoint: string;
    plannerToken?: string | undefined;
    routingPrefs: {
      mode: "open" | "subscriptions";
      subscriptions: Array<
        "claude" | "chatgpt" | "gemini" | "cursor" | "local_oss"
      >;
      quotaMode?: QuotaMode | undefined;
    };
    attachments: readonly BetaAttachment[];
    repoContext?: RepoContextSnapshot | undefined;
    repoOutcomes?: RepoOutcomesSummary | undefined;
    wantsStream: boolean;
    signal?: AbortSignal | undefined;
  },
  emit?: StreamEmitter,
): Promise<TurnExecutionResult> {
  const {
    messages,
    effort,
    strict,
    forcePlan,
    provider,
    model,
    key,
    endpoint,
    routingPrefs,
    attachments,
    repoContext,
    repoOutcomes,
    wantsStream,
    signal,
  } = params;

  let cachedSelfHosted: SelfHostedModel[] | null = null;
  const getSelfHostedModels = async (): Promise<SelfHostedModel[]> => {
    if (cachedSelfHosted !== null) return cachedSelfHosted;
    cachedSelfHosted = await listSelfHostedModels(params.plannerToken);
    return cachedSelfHosted;
  };

  const textOnlyFallbackModels = new Set<string>();
  const repoContextSummary = repoContext
    ? formatRepoContextPromptSection(repoContext)
    : "";

  const userMessages = messages.filter((m) => m.role === "user");
  let elevatedBrief = "";
  let architectReply =
    "Here is the sharpened architecture, task split, and per-task model routing based on your brief.";

  if (!forcePlan) {
    let triageModel = model;
    if (provider === "configured") {
      const selfHosted = await getSelfHostedModels();
      triageModel = selectWarmTriageModel(model, selfHosted);
    }

    emit?.("status", {
      phase: "triage",
      message:
        triageModel !== model
          ? `Triaging your request on warm model ${triageModel}...`
          : "Evaluating your request...",
      model: triageModel,
    });

    const triageSchema = z.toJSONSchema(TurnTriageSchema) as Record<
      string,
      unknown
    >;
    const triageUserPayload: Record<string, unknown> = {
      conversation: messages,
    };
    if (repoContext) {
      triageUserPayload.verifiedRepoContext = {
        ...repoContext,
        formattedSummary: repoContextSummary,
      };
    }
    if (attachments.length > 0) {
      triageUserPayload.attachedImages = attachments.map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType,
      }));
    }

    const hasPriorClarification = messages.some(
      (m) =>
        m.role === "assistant" &&
        m.content.includes("Clarifying questions asked:"),
    );
    const triageExemplarBlock = buildMatchedTriageExemplarPrompt(
      userMessages.map((m) => m.content).join(" "),
      hasPriorClarification,
    );
    const triageSystem = `${buildTriageSystem(repoContext)}\n\n${triageExemplarBlock}`;

    const triageResult = await callModelJson({
      provider,
      endpoint,
      model: triageModel,
      key,
      systemPrompt: triageSystem,
      userPrompt: JSON.stringify(triageUserPayload),
      schemaName: "anvilmark_turn_triage",
      schema: triageSchema,
      maxTokens: 1600,
      attachments,
      signal,
    });

    if (!triageResult.ok) {
      return {
        ok: false,
        status: triageResult.status,
        error: triageResult.error,
      };
    }
    if (triageResult.usedTextOnlyFallback) {
      textOnlyFallbackModels.add(triageModel);
    }

    let triage;
    try {
      triage = TurnTriageSchema.parse(JSON.parse(triageResult.text));
    } catch {
      return {
        ok: false,
        status: 502,
        error:
          "The model returned an unreadable reply. Try sending your message again or switching models.",
      };
    }

    if (triage.mode === "chat") {
      return {
        ok: true,
        payload: {
          mode: "chat",
          reply: triage.reply,
        },
      };
    }

    if (triage.mode === "clarify") {
      return {
        ok: true,
        payload: {
          mode: "clarify",
          reply: triage.reply,
          questions:
            triage.questions.length > 0
              ? triage.questions
              : defaultClarificationQuestions(),
        },
      };
    }

    elevatedBrief = triage.elevatedBrief;
    architectReply = triage.reply;

    emit?.("architect_summary", {
      reply: architectReply,
      elevatedBrief,
    });
  } else {
    const forcedBrief = userMessages
      .map((m) => m.content)
      .join("\n\n")
      .trim()
      .slice(0, 3600);
    emit?.("architect_summary", {
      reply: architectReply,
      elevatedBrief: forcedBrief,
    });
  }

  emit?.("status", {
    phase: "synthesis",
    message:
      "Synthesizing architecture decisions, slices, and model routing...",
    model,
  });

  const quotaMode: QuotaMode = routingPrefs.quotaMode ?? "plenty";
  const selfHosted =
    routingPrefs.subscriptions.includes("local_oss") ||
    routingPrefs.mode === "open" ||
    quotaMode === "conserve" ||
    quotaMode === "exhausted"
      ? await getSelfHostedModels()
      : [];
  const routingSnapshot = resolveRoutingPool(
    routingPrefs,
    selfHosted,
    repoOutcomes,
  );
  const candidates = routingSnapshot.candidates;

  const rawIdea =
    elevatedBrief.trim().length >= 10
      ? elevatedBrief.trim()
      : userMessages.map((m) => m.content).join("\n\n");
  const idea =
    rawIdea.length >= 10
      ? rawIdea.slice(0, 12000)
      : `${rawIdea} — software implementation plan`;

  const quotaGuidanceLine =
    quotaMode === "exhausted"
      ? "QUOTA ARBITRAGE (FRONTIER EXHAUSTED): Frontier cloud caps are exhausted. Route slices across am-server local OSS and fast/balanced models only."
      : quotaMode === "conserve"
        ? "QUOTA ARBITRAGE (CONSERVE FRONTIER): Frontier quota is scarce—assign a frontier model AT MOST once (only for high-risk auth/concurrency); spill all schema, CRUD, UI, and test slices onto local OSS or fast/balanced models."
        : "";

  const outcomesSummaryText = repoOutcomes
    ? formatOutcomesPromptSection(repoOutcomes)
    : "";

  const transcriptContextParts: string[] = [
    `Planning depth: ${effortGuidance[effort]}`,
    `Routing mode: ${routingPrefs.mode === "open" ? "Open best-fit across ecosystem" : `User subscriptions (${routingPrefs.subscriptions.join(", ")})`}`,
  ];
  if (quotaGuidanceLine) {
    transcriptContextParts.push(quotaGuidanceLine);
  }
  if (outcomesSummaryText) {
    transcriptContextParts.push(outcomesSummaryText.slice(0, 1800));
  }
  if (repoContextSummary) {
    transcriptContextParts.push(repoContextSummary.slice(0, 2600));
  }
  transcriptContextParts.push(
    `Conversation transcript:\n${messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n")}`,
  );
  const transcriptContext = transcriptContextParts.join("\n\n").slice(0, 8000);

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
  const planUserPayload: Record<string, unknown> = {
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
      ...(c.observedRuns !== undefined
        ? {
            observedRuns: c.observedRuns,
            observedFirstPassRate: c.observedFirstPassRate,
            empiricalScore: c.empiricalScore,
          }
        : {}),
      strengths: c.strengths,
    })),
  };
  if (repoOutcomes) {
    planUserPayload.observedRepoOutcomes = repoOutcomes;
  }
  if (repoContext) {
    planUserPayload.verifiedRepoContext = {
      ...repoContext,
      formattedSummary: repoContextSummary,
    };
  }
  if (attachments.length > 0) {
    planUserPayload.attachedImages = attachments.map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType,
    }));
  }

  const planExemplarBlock = buildMatchedPlanExemplarPrompt({
    idea: plannerInput.idea,
    effort,
    candidates,
  });
  const basePlanSystem = repoContext
    ? planSystemWithRepo
    : planSystemWithoutRepo;
  const fullPlanSystem = planExemplarBlock
    ? `${basePlanSystem}\n\n${planExemplarBlock}`
    : basePlanSystem;

  const planResult = await callModelJson({
    provider,
    endpoint,
    model,
    key,
    systemPrompt: fullPlanSystem,
    userPrompt: JSON.stringify(planUserPayload),
    schemaName: "anvilmark_plan",
    schema: planSchema,
    maxTokens: effort === "max" ? 12000 : 9500,
    attachments,
    skipVision: textOnlyFallbackModels.has(model),
    stream: wantsStream && (provider === "configured" || provider === "openai"),
    onProgress: emit
      ? (progress) => {
          emit("progress", progress);
        }
      : undefined,
    signal,
  });

  if (!planResult.ok) {
    return { ok: false, status: planResult.status, error: planResult.error };
  }

  try {
    const rawParsed = calibratePlanRouting({
      raw: JSON.parse(planResult.text),
      idea: plannerInput.idea,
      candidates,
      strict,
      quotaMode,
      outcomes: repoOutcomes,
      repoStack: repoContext,
    });
    const validatedPlan = validatePlan(rawParsed, plannerInput);
    const plan = {
      ...validatedPlan,
      tasks: validatedPlan.tasks.map((task) => ({
        ...task,
        contract: compileSliceContractForTask({
          task,
          flows: validatedPlan.flows,
          candidates,
          repoCheckCommands: repoContext?.checkCommands,
          sampleFiles: repoContext?.sampleFiles,
          strict,
        }),
      })),
    };
    const payload: BetaTurnResponse = {
      mode: "plan",
      reply: architectReply,
      plan,
      candidates,
      catalogDate: routingSnapshot.fetchedAt,
      strict,
      request: { idea: plannerInput.idea, context: plannerInput.context },
    };
    return { ok: true, payload };
  } catch {
    return {
      ok: false,
      status: 502,
      error:
        "The model returned an incomplete plan structure. Try regenerating or choosing a stronger planning model.",
    };
  }
}

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
      if (size > MAX_REQUEST_BYTES) {
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
    attachments = [],
    repoContext,
    repoOutcomes,
  } = parsed.data;

  const access = await getSelfHostedPlannerAccess();
  const key =
    (provider === "configured" ? access?.token : undefined) ||
    suppliedKey ||
    (provider === "google"
      ? (process.env.ANVILMARK_GEMINI_API_KEY?.trim() ?? "")
      : provider === "openai"
        ? (process.env.ANVILMARK_OPENAI_API_KEY?.trim() ?? "")
        : "");

  const endpoint =
    provider === "configured"
      ? access?.endpoint
      : provider === "google"
        ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
        : "https://api.openai.com/v1/chat/completions";

  if (!endpoint) {
    return jsonError(
      process.env.ANVILMARK_PLANNER_AUTH === "vercel-oidc"
        ? "The self-hosted planner connection is unavailable."
        : "A self-hosted endpoint has not been configured on this web server.",
      503,
    );
  }
  if (!key && provider !== "configured") {
    return jsonError("Enter your provider API key.", 400);
  }

  const wantsStream =
    request.headers.get("accept")?.includes("text/event-stream") ?? false;

  if (!wantsStream) {
    const outcome = await executeTurn({
      messages,
      effort,
      strict,
      forcePlan,
      provider,
      model,
      key,
      endpoint,
      plannerToken: access?.token,
      routingPrefs,
      attachments,
      repoContext,
      repoOutcomes,
      wantsStream: false,
      signal: request.signal,
    });
    if (!outcome.ok) {
      return jsonError(outcome.error, outcome.status);
    }
    return NextResponse.json(outcome.payload, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send: StreamEmitter = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };

      try {
        const outcome = await executeTurn(
          {
            messages,
            effort,
            strict,
            forcePlan,
            provider,
            model,
            key,
            endpoint,
            plannerToken: access?.token,
            routingPrefs,
            attachments,
            repoContext,
            repoOutcomes,
            wantsStream: true,
            signal: request.signal,
          },
          send,
        );
        if (outcome.ok) {
          send("done", outcome.payload);
        } else {
          send("error", { error: outcome.error, status: outcome.status });
        }
      } catch {
        send("error", {
          error: "Could not complete the streaming turn.",
          status: 500,
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Consumer already closed the stream.
          }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
