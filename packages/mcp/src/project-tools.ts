import { registerHardwareTools } from "./hardware-tools.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  StoreError,
  loadProject,
  readStoredScan,
  readStoredConformance,
  prepareCurrentConformance,
} from "@anvilmark/cli";
import type {
  ConformanceQueryResult,
  ConformanceToolName,
} from "@anvilmark/conformance";
import {
  runConformanceQuery,
  CONFORMANCE_ARGUMENTS,
} from "@anvilmark/conformance";
import type {
  ProjectToolName,
  ProjectionName,
  QueryError,
  QueryErrorCode,
  QueryResult,
} from "@anvilmark/context";
import { runProjectQuery } from "@anvilmark/context";
import type {
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

/**
 * The vNext, read-only ANVILMARK project server.
 *
 * Separate from the historical audit scaffold in `server.ts`, whose tools run
 * over the 0.1.0 `@anvilmark/contract` fixtures and are not project-contract
 * tools. Every call loads the contract afresh and returns a projected response
 * with its source marker. Conformance tools also rescan the locally selected
 * source in memory; saved artifacts establish selection, not freshness. No
 * tool writes, records decisions/exceptions, imports proposals, runs remote
 * provider evaluations or generates files.
 */

export const PROJECT_SERVER_NAME = "anvilmark-project";
export const PROJECT_SERVER_VERSION = "0.1.0-draft.2";

export interface ProjectServerOptions {
  readonly hardwareSizing?: boolean;
  readonly hardwareProbe?: boolean;
  /** Directory containing `.anvilmark/`. */
  readonly root: string;
  readonly projection: ProjectionName;
  /** A fixed evaluation instant. When absent, `clock` is read per call. */
  readonly asOf?: string;
  readonly clock: () => string;
  /** Local diagnostics sink (standard error for the stdio entry). Never a tool payload. */
  readonly diagnostics?: (message: string) => void;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const workloadFilter = z
  .string()
  .min(1)
  .describe("A workload id from get_project_summary");

export type ExtendedToolName = ProjectToolName | ConformanceToolName;

export type ToolResponse = QueryResult | ConformanceQueryResult;

const TOOLS: readonly {
  readonly name: ExtendedToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
}[] = [
  {
    name: "get_project_summary",
    title: "ANVILMARK project summary",
    description:
      "Read-only. Intent, outcomes, non-goals, priority order, unresolved questions, workloads with their instruction-eligible decision if any, decision standings and counts, with the contract source marker.",
    inputSchema: z.strictObject({}),
  },
  {
    name: "get_constraints",
    title: "ANVILMARK constraints",
    description:
      "Read-only. Declared constraints with exceptions and whether each exception is active at as_of. Optional filters: workload (constraints naming it, its data classifications, or the project), severity (hard, soft, informational), domain.",
    inputSchema: z.strictObject({
      workload: workloadFilter.optional(),
      severity: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
    }),
  },
  {
    name: "get_workload_decision",
    title: "ANVILMARK workload decision",
    description:
      "Read-only. Decisions for one workload with standing, instruction eligibility, selected deployment, estimates, cited evidence freshness and evidence gaps. Only decisions with instruction_eligible true are instructions.",
    inputSchema: z.strictObject({ workload: workloadFilter }),
  },
  {
    name: "get_architecture_context",
    title: "ANVILMARK architecture context",
    description:
      "Read-only. Declared architecture nodes and relationships with trust boundaries, crossings, workload placement, linked decisions and constraints, and unresolved support. Optional filters: component (a node id), workload.",
    inputSchema: z.strictObject({
      component: z
        .string()
        .min(1)
        .describe("An architecture node id")
        .optional(),
      workload: workloadFilter.optional(),
    }),
  },
  {
    name: "list_evidence_gaps",
    title: "ANVILMARK evidence gaps",
    description:
      "Read-only. Missing, stale, below-floor and unknown evidence per workload and candidate, evaluated at as_of. Optional filter: workload.",
    inputSchema: z.strictObject({ workload: workloadFilter.optional() }),
  },
  {
    name: "run_conformance",
    title: "ANVILMARK run conformance",
    description:
      "Read-only. Evaluates conformance of the repository against contract rules. Returns verdicts, summary and hashes. Cannot mutate project state, record decisions, create exceptions, weaken constraints, or modify source.",
    inputSchema: CONFORMANCE_ARGUMENTS.run_conformance,
  },
  {
    name: "check_proposed_change",
    title: "ANVILMARK check proposed change",
    description:
      "Read-only. Checks candidate eligibility or freshly analyzes selected source files within the full repository. Cannot mutate project state, record decisions, create exceptions, weaken constraints, or modify source.",
    inputSchema: CONFORMANCE_ARGUMENTS.check_proposed_change,
  },
  {
    name: "get_conformance_result",
    title: "ANVILMARK get conformance result",
    description:
      "Read-only. Retrieves a current conformance result by ID. Source traces, locations and remediation details are included only with local-disclosed projection. Cannot mutate project state, record decisions, create exceptions, weaken constraints, or modify source.",
    inputSchema: CONFORMANCE_ARGUMENTS.get_conformance_result,
  },
];

/**
 * The advertised argument schema is the strict Zod schema, so `tools/list`
 * tells a client exactly which arguments exist. Enforcement happens in the
 * shared query layer instead of the SDK's pre-validation, so that an unknown,
 * missing or mistyped argument gets the same structured, source-marked error
 * as an unknown workload or component, with the valid values listed.
 */
function advertised(
  schema: z.ZodObject,
): StandardSchemaWithJSON<Record<string, unknown>> {
  const standard = schema["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "anvilmark",
      validate: (value: unknown) =>
        value === undefined
          ? { value: {} }
          : typeof value === "object" && value !== null && !Array.isArray(value)
            ? { value: value as Record<string, unknown> }
            : { issues: [{ message: "tool arguments must be a JSON object" }] },
      jsonSchema: standard.jsonSchema,
    },
  };
}

function toResult(result: ToolResponse): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result as unknown as Record<string, unknown>,
    ...(result.ok ? {} : { isError: true }),
  };
}

const PROJECT_ERRORS = {
  project_not_found:
    "No ANVILMARK project was found in the directory this server was started with. Start the server with --project-dir naming a directory that contains .anvilmark/project.yaml, or initialize a project there with anvilmark init.",
  project_unreadable:
    "The project contract or its history could not be read by this server. The reason is reported only in the server's local diagnostics.",
  project_invalid:
    "The project contract did not validate, so no facts were produced. Run anvilmark validate locally for details.",
  projection_refused:
    "The requested projection could not be produced safely from this contract, so nothing was returned. The reason is reported only in the server's local diagnostics.",
  internal_error:
    "The server could not answer this request. The reason is reported only in the server's local diagnostics.",
  invalid_arguments: "Arguments do not match the required tool parameters.",
} as const;

type ProjectErrorCode = keyof typeof PROJECT_ERRORS;

/**
 * A project-level failure as a tool response (correction R2).
 *
 * The payload is built from fixed text and a code. Local diagnostics (paths,
 * exception messages) never enter it: they go to `diagnostics`, which the
 * stdio entry writes to standard error on the local machine. Even validation
 * paths can contain private unknown property names or dynamic record keys;
 * no validation detail from the invalid document enters the payload.
 */
function projectError(
  tool: ExtendedToolName,
  code: ProjectErrorCode,
): QueryError {
  return {
    ok: false,
    tool: tool as ProjectToolName,
    source: null,
    error: {
      code: code as QueryErrorCode,
      message: PROJECT_ERRORS[code],
      field: null,
      value: null,
      valid_values: [],
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function answerProjectTool(
  options: ProjectServerOptions,
  tool: ExtendedToolName,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolResponse> {
  const diagnostics = options.diagnostics ?? (() => undefined);
  try {
    await readFile(join(options.root, ".anvilmark", "project.yaml"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    diagnostics(
      `${tool}: project contract not readable: ${describeError(error)}`,
    );
    return projectError(
      tool,
      code === "ENOENT" || code === "ENOTDIR"
        ? "project_not_found"
        : "project_unreadable",
    );
  }
  let loaded;
  try {
    loaded = await loadProject(options.root);
  } catch (error) {
    diagnostics(
      `${tool}: project could not be loaded: ${describeError(error)}`,
    );
    if (error instanceof StoreError && error.issues.length > 0) {
      for (const issue of error.issues.slice(0, 20)) {
        diagnostics(`${tool}: [${issue.code}] ${issue.path}: ${issue.message}`);
      }
      return projectError(tool, "project_invalid");
    }
    return projectError(tool, "project_unreadable");
  }

  // Handle standard read tools
  if (
    tool === "get_project_summary" ||
    tool === "get_constraints" ||
    tool === "get_workload_decision" ||
    tool === "get_architecture_context" ||
    tool === "list_evidence_gaps"
  ) {
    try {
      return runProjectQuery(tool, args, {
        contract: loaded.contract,
        stateRevision: loaded.head?.revision ?? null,
        asOf: options.asOf ?? options.clock(),
        projection: options.projection,
      });
    } catch (error) {
      const message = describeError(error);
      diagnostics(`${tool}: ${message}`);
      return projectError(
        tool,
        message.startsWith("refusing to produce")
          ? "projection_refused"
          : "internal_error",
      );
    }
  }

  // Conformance replies use the same error and projection boundary as facts.
  try {
    const asOf = options.asOf ?? options.clock();
    const context = {
      contract: loaded.contract,
      stateRevision: loaded.head?.revision ?? null,
      asOf,
      projection: options.projection,
      scan: null,
    };
    if (
      !CONFORMANCE_ARGUMENTS[tool].safeParse(args).success ||
      (tool === "check_proposed_change" && args.files === undefined)
    )
      return runConformanceQuery(tool, args, context);
    const storedScan = await readStoredScan(options.root);
    const storedReport = await readStoredConformance(options.root);
    if (storedScan.status !== "valid" && storedReport.status !== "valid")
      return runConformanceQuery(tool, args, {
        ...context,
        scanStatus:
          storedScan.status === "missing" && storedReport.status === "missing"
            ? "missing"
            : "unavailable",
      });
    const current = await prepareCurrentConformance({
      root: options.root,
      clock: options.clock,
      evaluatedAt: asOf,
    });
    const response = runConformanceQuery(tool, args, {
      ...context,
      contract: current.prepared.contract,
      stateRevision: current.prepared.stateRevision,
      scan: current.artifact,
    });
    await current.recheck();
    return response;
  } catch (error) {
    const message = describeError(error);
    diagnostics(`${tool}: ${message}`);
    return projectError(
      tool,
      message.startsWith("refusing to produce")
        ? "projection_refused"
        : "internal_error",
    );
  }
}

export function createProjectServer(options: ProjectServerOptions): McpServer {
  const server = new McpServer({
    name: PROJECT_SERVER_NAME,
    version: PROJECT_SERVER_VERSION,
  });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: advertised(tool.inputSchema),
        annotations: READ_ONLY,
      },
      async (args: Record<string, unknown>) =>
        toResult(await answerProjectTool(options, tool.name, args ?? {})),
    );
  }
  registerHardwareTools(server, options);
  return server;
}
