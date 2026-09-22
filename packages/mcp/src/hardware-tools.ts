import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type {
  McpServer,
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import {
  discoverLocalModels,
  probeLocalHardware,
  sanitizeErrorMessage,
} from "@anvilmark/adapters";
import {
  MAX_ARTIFACT_BYTES,
  SizingInputSchema,
  createSizingArtifact,
  listModelProfiles,
  projectProbeForSharing,
} from "@anvilmark/hardware-sizing";
import type { ProjectServerOptions } from "./project-tools.js";
const result = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
const hashText = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export function registerHardwareTools(
  server: McpServer,
  options: ProjectServerOptions,
): void {
  const add = (
    name: string,
    description: string,
    schema: z.ZodObject,
    openWorld: boolean,
    run: (args: Record<string, unknown>) => Promise<unknown>,
  ) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema as unknown as StandardSchemaWithJSON<
          Record<string, unknown>
        >,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: !openWorld,
          openWorldHint: openWorld,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          schema.parse(args);
          if (Buffer.byteLength(JSON.stringify(args)) > MAX_ARTIFACT_BYTES)
            throw new Error("Hardware request exceeds 1 MiB.");
          return result(await run(args));
        } catch (error) {
          return {
            ...result({
              error: sanitizeErrorMessage(
                error instanceof Error
                  ? error.message
                  : "Hardware request failed",
              ),
            }),
            isError: true,
          };
        }
      },
    );
  if (options.hardwareSizing) {
    add(
      "get_hardware_model_catalog",
      "Pinned model metadata for memory planning. No quality ranking.",
      z.strictObject({}),
      false,
      async () => ({ models: listModelProfiles() }),
    );
    add(
      "estimate_hardware_fit",
      "Pure memory arithmetic over explicit T1 scenario assumptions. No evidence attachment or performance verdict.",
      z.strictObject({ input: SizingInputSchema }),
      false,
      async (args) =>
        createSizingArtifact(args.input, {
          evaluatedAt: options.asOf ?? options.clock(),
          hashText,
        }),
    );
  }
  if (options.hardwareProbe) {
    add(
      "probe_local_hardware",
      "Explicit startup capability. Bounded local inventory subprocesses; no project writes, target replacement, SSH destination or arbitrary command input.",
      z.strictObject({}),
      true,
      async () => {
        const snapshot = await probeLocalHardware({
          dependencies: { clock: options.clock },
        });
        return options.projection === "local-disclosed"
          ? snapshot
          : projectProbeForSharing(snapshot);
      },
    );
    add(
      "discover_local_model_inventory",
      "Explicit startup capability. Fixed loopback GET listings only; no credentials, redirects or inference. Listings do not prove local execution or readiness.",
      z.strictObject({}),
      true,
      async () => ({
        inventory: (await discoverLocalModels()).map((item) =>
          options.projection === "local-disclosed"
            ? item
            : {
                ...item,
                models: item.models.map((_, index) => `model-${index + 1}`),
              },
        ),
      }),
    );
  }
}
