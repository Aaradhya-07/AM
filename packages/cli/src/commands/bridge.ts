import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { z } from "zod";

import { EXIT } from "../io.js";
import { applyPlan, parseBundle } from "./apply-plan.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  numberOption,
  parse,
  projectDirectory,
  stringOption,
} from "./common.js";
import { measureDrift } from "./drift.js";
import { exportRepoContext } from "./export-context.js";
import { aggregateOutcomes, outcomesRepoName } from "./outcomes.js";
import {
  ACTIVE_PLAN,
  fromRoot,
  inspectPath,
  writeRepoJson,
} from "./slice-storage.js";
import { SliceId, verifySlice } from "./verify-slice.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const LIMIT = 2 * 1024 * 1024;
const TOKEN_FILE = ".anvilmark/development/bridge.json";
const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const BRIDGE_USAGE =
  "Usage: anvilmark bridge [-C DIR] [--port 4317] [--allow-origin ORIGIN] [--allow-check COMMAND] [--token-file .anvilmark/development/bridge.json]";
const VerifyRequest = z.strictObject({
  sliceId: SliceId,
  runChecks: z.boolean().optional(),
});

type Event = "slice_status" | "plan_applied" | "drift_updated";

interface BridgeOptions {
  root: string;
  port?: number;
  host?: string;
  allowOrigins?: readonly string[];
  tokenFile?: boolean;
  approvedCommands?: readonly string[];
  clock?: () => string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function respond(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    const tooLarge = () => new HttpError(413, "Request body exceeds 2 MB.");
    if (Number(request.headers["content-length"]) > LIMIT) {
      request.resume();
      fail(tooLarge());
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > LIMIT) {
        chunks.length = 0;
        fail(tooLarge());
      } else {
        chunks.push(chunk);
      }
    });
    request.once("error", () =>
      fail(new HttpError(400, "Request body interrupted.")),
    );
    request.once("end", () => {
      if (bytes > LIMIT) return;
      try {
        done(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        fail(new HttpError(400, "Expected a JSON request body."));
      }
    });
  });
}

function allowedOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.origin !== origin
  )
    throw new Error("Expected an exact HTTP(S) origin");
  return origin;
}

export async function startBridge(options: BridgeOptions) {
  if (options.host !== undefined && options.host !== HOST)
    throw new Error("Bridge must bind to 127.0.0.1");
  if (!(await lstat(options.root)).isDirectory())
    throw new Error("Expected a real repository directory");
  const root = await realpath(options.root);
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error("Invalid bridge port");
  const origins = new Set([
    ...DEFAULT_ORIGINS,
    ...(options.allowOrigins ?? []).map(allowedOrigin),
  ]);
  const tokenBytes = randomBytes(32);
  const token = tokenBytes.toString("hex");
  const clock = options.clock ?? (() => new Date().toISOString());
  const approvedCommands = new Set(options.approvedCommands);
  const clients = new Set<ServerResponse>();
  const shutdown = new AbortController();

  const matchesToken = (value: string | undefined) =>
    value !== undefined &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value, "hex"), tokenBytes);

  const emit = (event: Event, value: unknown) => {
    const data =
      "event: " + event + "\ndata: " + JSON.stringify(value) + "\n\n";
    for (const client of clients) {
      if (!client.write(data)) client.destroy();
    }
  };
  const driftUpdate = () => {
    if (clients.size)
      void measureDrift(root, clock())
        .then((report) => {
          emit("drift_updated", report);
        })
        .catch(() => {
          // An unreadable snapshot must not leak error details through SSE.
        });
  };

  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    (request, response) => {
      void handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        if (error instanceof HttpError) {
          if (error.status === 413) response.setHeader("Connection", "close");
          respond(response, error.status, { error: error.message });
        } else {
          respond(response, 422, {
            error: "Bridge request could not be completed.",
          });
        }
      });
    },
  );
  server.maxConnections = 64;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const { method, headers } = request;
    const authority = headers.host;
    if (
      typeof authority !== "string" ||
      !/^(127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(authority)
    )
      throw new HttpError(403, "Host is outside loopback.");
    const target = request.url;
    if (!target?.startsWith("/") || target.startsWith("//"))
      throw new HttpError(400, "Invalid request target.");
    const url = new URL(target, "http://" + HOST);
    if (url.origin !== "http://" + HOST)
      throw new HttpError(400, "Invalid request target.");

    response.setHeader("Vary", "Origin");
    const origin = headers.origin;
    if (origin !== undefined) {
      if (!origins.has(origin))
        throw new HttpError(403, "Origin is not allowed.");
      response.setHeader("Access-Control-Allow-Origin", origin);
    }
    if (method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Anvilmark-Bridge-Token",
      );
      if (
        origin &&
        headers["access-control-request-private-network"] === "true"
      )
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.writeHead(204).end();
      return;
    }

    const bearer = /^Bearer (\w+)$/i.exec(headers.authorization ?? "")?.[1];
    const bridgeToken = headers["x-anvilmark-bridge-token"];
    const sse = method === "GET" && url.pathname === "/v1/events";
    if (
      !matchesToken(bearer) &&
      !matchesToken(
        typeof bridgeToken === "string" ? bridgeToken : undefined,
      ) &&
      !(sse && matchesToken(url.searchParams.get("token") ?? undefined))
    )
      throw new HttpError(401, "Bridge pairing token required.");

    switch (method + " " + url.pathname) {
      case "GET /v1/health":
        respond(response, 200, {
          ok: true,
          version: "1",
          repoName: await outcomesRepoName(root),
          projectDir: root,
          hasActivePlan: (await inspectPath(root, ACTIVE_PLAN)) !== null,
        });
        break;
      case "GET /v1/context":
        respond(response, 200, await exportRepoContext(root, { now: clock() }));
        break;
      case "GET /v1/outcomes":
        respond(response, 200, await aggregateOutcomes(root, clock()));
        break;
      case "GET /v1/drift": {
        const report = await measureDrift(root, clock());
        respond(response, 200, report);
        emit("drift_updated", report);
        break;
      }
      case "POST /v1/apply-plan": {
        const raw = await readBody(request);
        let bundle;
        try {
          bundle = parseBundle(raw);
        } catch {
          throw new HttpError(400, "Invalid plan handoff bundle.");
        }
        const files = await applyPlan(root, bundle);
        const applied = {
          applied: true,
          writtenFiles: files
            .filter(({ action }) => action !== "unchanged")
            .map(({ path }) => path),
        };
        respond(response, 200, applied);
        emit("plan_applied", applied);
        driftUpdate();
        break;
      }
      case "POST /v1/verify-slice": {
        const parsed = VerifyRequest.safeParse(await readBody(request));
        if (!parsed.success)
          throw new HttpError(400, "Invalid slice verification request.");
        const controller = new AbortController();
        const disconnect = () => controller.abort();
        response.once("close", disconnect);
        try {
          const report = await verifySlice({
            root,
            sliceId: parsed.data.sliceId,
            runChecks: parsed.data.runChecks ?? false,
            approvedCommands,
            clock,
            signal: AbortSignal.any([controller.signal, shutdown.signal]),
          });
          respond(response, 200, report);
          emit("slice_status", report);
          driftUpdate();
        } finally {
          response.off("close", disconnect);
        }
        break;
      }
      case "GET /v1/events":
        if (clients.size >= 32)
          throw new HttpError(503, "Too many bridge event connections.");
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Content-Type-Options": "nosniff",
        });
        response.write(": connected\n\n");
        clients.add(response);
        response.on("close", () => clients.delete(response));
        break;
      default:
        throw new HttpError(404, "Bridge route not found.");
    }
  }

  await new Promise<void>((done, fail) => {
    const onError = (error: Error) => fail(error);
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.off("error", onError);
      done();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Bridge did not bind a TCP port");
  const url = "http://" + HOST + ":" + address.port;
  const heartbeat = setInterval(() => {
    for (const client of clients)
      if (!client.write(": keep-alive\n\n")) client.destroy();
  }, 15_000);
  heartbeat.unref();
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= new Promise<void>((done) => {
      clearInterval(heartbeat);
      shutdown.abort();
      for (const client of clients) client.end();
      server.close(() => done());
      server.closeAllConnections();
    }));
  try {
    if (options.tokenFile)
      await writeRepoJson(root, TOKEN_FILE, { url, token });
  } catch (error) {
    await close();
    throw error;
  }
  return { url, token, close };
}

export async function bridgeCommand({ args, io }: CommandContext) {
  // Both the bare flag and the documented fixed path are accepted.
  const normalized = args.flatMap((arg, i) =>
    arg === "--token-file" && (!args[i + 1] || args[i + 1]?.startsWith("-"))
      ? [arg, TOKEN_FILE]
      : [arg],
  );
  const parsed = parse(
    normalized,
    {
      port: { type: "string" },
      host: { type: "string" },
      "allow-check": { type: "string", multiple: true },
      "allow-origin": { type: "string", multiple: true },
      "token-file": { type: "string" },
    },
    BRIDGE_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(BRIDGE_USAGE + "\n");
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("Unexpected positional argument", BRIDGE_USAGE);
  const root = projectDirectory(io, parsed);
  const tokenFile = stringOption(parsed, "token-file");
  if (tokenFile && fromRoot(root, resolve(root, tokenFile)) !== TOKEN_FILE)
    throw new UsageError(
      "Bridge token file must be " + TOKEN_FILE,
      BRIDGE_USAGE,
    );
  const host = stringOption(parsed, "host");
  const origins = parsed.values["allow-origin"];
  const checks = parsed.values["allow-check"];
  const bridge = await startBridge({
    root,
    port: numberOption(parsed, "port", BRIDGE_USAGE) ?? DEFAULT_PORT,
    ...(host === undefined ? {} : { host }),
    ...(Array.isArray(origins) ? { allowOrigins: origins } : {}),
    ...(Array.isArray(checks) ? { approvedCommands: checks } : {}),
    tokenFile: tokenFile !== undefined,
    clock: io.clock,
  });
  io.stdout(
    "Bridge pairing URL " +
      bridge.url +
      "\nBridge pairing token " +
      bridge.token +
      "\n",
  );
  try {
    await new Promise<void>((done) => {
      const stop = () => {
        process.removeListener("SIGTERM", stop);
        io.signal.removeEventListener("abort", stop);
        done();
      };
      process.once("SIGTERM", stop);
      io.signal.addEventListener("abort", stop, { once: true });
      if (io.signal.aborted) stop();
    });
  } finally {
    await bridge.close();
  }
  return EXIT.ok;
}
