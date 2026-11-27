import {
  appendSliceOutcome,
  loadSlicePlan,
  readSliceOutcomes,
  SliceId,
  sliceDigest,
  SliceOutcomeInputSchema,
  verifySlice,
  type SliceVerificationReport,
} from "@anvilmark/cli";
import type { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { lstat, realpath } from "node:fs/promises";
import { z } from "zod";

interface SliceToolOptions {
  root: string;
  clock: () => string;
  sliceExecution?: boolean;
  sliceApprovedCommands?: readonly string[];
  localStudio?: boolean;
  getActiveRoot?: () => string;
  setActiveRoot?: (nextDir: string) => void;
  diagnostics?: (message: string) => void;
}

const ProjectDirField = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .optional()
  .describe("Absolute path to the target Git workspace directory");

const SliceArgs = z.strictObject({ slice_id: SliceId });
const VerifyArgs = SliceArgs.extend({ run_checks: z.boolean().optional() });

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function result(
  value: Record<string, unknown>,
  isError = false,
): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

export function registerSliceTools(
  server: McpServer,
  options: SliceToolOptions,
): void {
  const approvedCommands = new Set(options.sliceApprovedCommands);
  const latest = new Map<string, SliceVerificationReport>();
  let currentPlan = "";
  const root = async (overrideDir?: string) => {
    const candidate =
      (options.localStudio && overrideDir?.trim()) ||
      options.getActiveRoot?.() ||
      options.root;
    if (!(await lstat(candidate)).isDirectory())
      throw new Error("Project directory is unavailable");
    const resolved = await realpath(candidate);
    if (options.localStudio && overrideDir?.trim()) {
      options.setActiveRoot?.(resolved);
    }
    return resolved;
  };
  const planState = async (overrideDir?: string) => {
    const directory = await root(overrideDir);
    const bundle = await loadSlicePlan(directory);
    if (!bundle) throw new Error("No active slice plan");
    const identity = JSON.stringify(bundle);
    if (identity !== currentPlan) latest.clear();
    currentPlan = identity;
    return { directory, bundle, identity, planSha256: sliceDigest(identity) };
  };

  const handle =
    <T>(name: string, handler: (args: T) => Promise<Record<string, unknown>>) =>
    async (args: T): Promise<CallToolResult> => {
      try {
        const value = await handler(args);
        return result(value, value.recorded === false);
      } catch (error) {
        options.diagnostics?.(
          name + ": " + (error instanceof Error ? error.name : "Error"),
        );
        return result(
          {
            error:
              "Slice request refused. Check the active plan and local verification state.",
          },
          true,
        );
      }
    };

  async function verify(id: string, checks: boolean, overrideDir?: string) {
    const { directory, bundle, identity, planSha256 } =
      await planState(overrideDir);
    const report = await verifySlice({
      root: directory,
      bundle,
      sliceId: id,
      runChecks: checks,
      approvedCommands,
      clock: options.clock,
    });
    if (JSON.stringify(await loadSlicePlan(directory)) !== identity)
      throw new Error("Active plan changed during verification");
    latest.set(id, report);
    return { directory, report, planSha256 };
  }

  const ListArgsSchema = options.localStudio
    ? z.strictObject({ project_dir: ProjectDirField })
    : z.strictObject({});
  const GetContractArgsSchema = options.localStudio
    ? SliceArgs.extend({ project_dir: ProjectDirField })
    : SliceArgs;
  const VerifyArgsSchema = options.localStudio
    ? VerifyArgs.extend({ project_dir: ProjectDirField })
    : VerifyArgs;
  const OutcomeArgsSchema = options.localStudio
    ? SliceOutcomeInputSchema.extend({ project_dir: ProjectDirField })
    : SliceOutcomeInputSchema;

  server.registerTool(
    "list_plan_slices",
    {
      description:
        "List active slices, routing, and latest local verification and outcome status.",
      inputSchema: ListArgsSchema,
      annotations: readOnly,
    },
    handle(
      "list_plan_slices",
      async (args: { project_dir?: string | undefined }) => {
        const { directory, bundle, planSha256 } = await planState(
          args.project_dir,
        );
        const outcomes = new Map(
          (await readSliceOutcomes(directory))
            .filter(
              (record) =>
                record.plan_sha256 === undefined ||
                record.plan_sha256 === planSha256,
            )
            .map((record) => [record.slice_id, record]),
        );
        return {
          tasks: bundle.plan.tasks.map((task) => {
            const route = bundle.candidates.find(
              ({ model }) => model === task.model,
            );
            const outcome = outcomes.get(task.id);
            const report = latest.get(task.id);
            return {
              id: task.id,
              title: task.title,
              dependsOn: task.dependsOn,
              model: task.model,
              provider: route?.provider ?? null,
              contract: task.contract
                ? {
                    allowedGlobs: task.contract.allowedGlobs,
                    forbiddenGlobs: task.contract.forbiddenGlobs,
                    allowDependencyChanges:
                      task.contract.allowDependencyChanges,
                    expectedBoundaries: task.contract.expectedBoundaries,
                    reviewerFamily: task.contract.reviewerFamily ?? null,
                    verificationCommandCount:
                      task.contract.verificationCommands.length,
                  }
                : null,
              latestVerification: report
                ? { passed: report.passed, verifiedAt: report.verifiedAt }
                : outcome
                  ? {
                      passed: outcome.verification_passed,
                      verifiedAt: outcome.verified_at ?? outcome.recorded_at,
                    }
                  : null,
              latestOutcome: outcome
                ? { status: outcome.status, recordedAt: outcome.recorded_at }
                : null,
            };
          }),
        };
      },
    ),
  );

  server.registerTool(
    "get_slice_contract",
    {
      description: "Read instructions and the contract for one active slice.",
      inputSchema: GetContractArgsSchema,
      annotations: readOnly,
    },
    handle(
      "get_slice_contract",
      async ({
        slice_id,
        project_dir,
      }: {
        slice_id: string;
        project_dir?: string | undefined;
      }) => {
        const { bundle } = await planState(project_dir);
        const task = bundle.plan.tasks.find(({ id }) => id === slice_id);
        if (!task) throw new Error("Unknown slice id");
        return { ...task, contract: task.contract ?? null };
      },
    ),
  );

  server.registerTool(
    "verify_slice",
    {
      description:
        "Verify a slice against Git changes. Set run_checks false for read-only verification.",
      inputSchema: VerifyArgsSchema,
      annotations: {
        ...readOnly,
        readOnlyHint: !options.sliceExecution,
        idempotentHint: false,
      },
    },
    handle(
      "verify_slice",
      async ({
        slice_id,
        run_checks,
        project_dir,
      }: {
        slice_id: string;
        run_checks?: boolean | undefined;
        project_dir?: string | undefined;
      }) => {
        if (run_checks && !options.sliceExecution)
          throw new Error("Check execution requires opt-in");
        return {
          ...(
            await verify(
              slice_id,
              run_checks ?? Boolean(options.sliceExecution),
              project_dir,
            )
          ).report,
        };
      },
    ),
  );

  if (options.sliceExecution) {
    server.registerTool(
      "record_slice_outcome",
      {
        description:
          "Verify the current slice and append structured model usage and outcome evidence to the local ledger.",
        inputSchema: OutcomeArgsSchema,
        annotations: {
          ...readOnly,
          readOnlyHint: false,
          idempotentHint: false,
        },
      },
      handle(
        "record_slice_outcome",
        async (
          input: z.infer<typeof SliceOutcomeInputSchema> & {
            project_dir?: string | undefined;
          },
        ) => {
          if (input.retries >= input.attempts)
            throw new Error("Invalid attempt counts");
          const { project_dir, ...cleanInput } = input;
          const { directory, report, planSha256 } = await verify(
            cleanInput.slice_id,
            true,
            project_dir,
          );
          if (cleanInput.status === "accepted" && !report.passed)
            return { recorded: false, verification: report };
          if (
            cleanInput.verification_passed !== undefined &&
            cleanInput.verification_passed !== report.passed
          )
            throw new Error(
              "Submitted verification state does not match the current result",
            );
          return {
            recorded: true,
            outcome: await appendSliceOutcome(
              directory,
              cleanInput,
              report.passed,
              options.clock(),
              { planSha256, verifiedAt: report.verifiedAt },
            ),
          };
        },
      ),
    );
  }
}
