import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import { inventoryRepository } from "@anvilmark/scanner";
import type { z } from "zod";

import type { HandoffPlan } from "./apply-plan.js";
import { isSensitivePath } from "./export-context.js";

type Flow = z.infer<typeof HandoffPlan>["flows"][number];

export interface ObservedEdge {
  from: string;
  to: string;
  kind: "import" | "boundary" | "provider" | "sdk";
  boundary?: string;
}

const POLYGLOT_SKIP_DIRS = new Set([
  ".git",
  ".anvilmark",
  "node_modules",
  "dist",
  "dist-npm",
  "build",
  ".next",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  "coverage",
]);

const MAX_POLYGLOT_FILES = 1500;
const MAX_POLYGLOT_FILE_BYTES = 256 * 1024;

const PYTHON_AI_SDKS: ReadonlyMap<string, string> = new Map([
  ["openai", "openai"],
  ["anthropic", "anthropic"],
  ["google.genai", "google-genai"],
  ["google.generativeai", "google-generativeai"],
  ["litellm", "litellm"],
  ["langchain", "langchain"],
  ["langchain_openai", "langchain-openai"],
  ["langchain_anthropic", "langchain-anthropic"],
  ["llama_index", "llama-index"],
  ["ollama", "ollama"],
  ["vllm", "vllm"],
  ["dspy", "dspy"],
  ["pydantic_ai", "pydantic-ai"],
]);

const PYTHON_BOUNDARY_MODULES: ReadonlyMap<string, string> = new Map([
  ["fastapi", "http-api"],
  ["flask", "http-api"],
  ["sqlalchemy", "database"],
  ["asyncpg", "database"],
  ["psycopg", "database"],
  ["psycopg2", "database"],
  ["sqlite3", "database"],
]);

const GO_AI_SDKS: readonly { prefix: string; name: string }[] = [
  { prefix: "github.com/openai/openai-go", name: "openai-go" },
  { prefix: "github.com/sashabaranov/go-openai", name: "go-openai" },
  {
    prefix: "github.com/anthropics/anthropic-sdk-go",
    name: "anthropic-sdk-go",
  },
  { prefix: "google.golang.org/genai", name: "google-genai-go" },
  { prefix: "github.com/ollama/ollama", name: "ollama-go" },
  { prefix: "github.com/tmc/langchaingo", name: "langchaingo" },
];

const RUST_AI_CRATES: ReadonlyMap<string, string> = new Map([
  ["async-openai", "async-openai"],
  ["async_openai", "async-openai"],
  ["rig-core", "rig-core"],
  ["rig", "rig-core"],
  ["ollama-rs", "ollama-rs"],
  ["ollama_rs", "ollama-rs"],
  ["candle-core", "candle-core"],
  ["candle_core", "candle-core"],
  ["ort", "onnxruntime"],
]);

function walkPolyglotFiles(root: string): string[] {
  const results: string[] = [];
  const stack: string[] = [""];

  while (stack.length > 0 && results.length < MAX_POLYGLOT_FILES) {
    const relDir = stack.pop()!;
    const absDir = relDir ? join(root, relDir) : root;
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= MAX_POLYGLOT_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isSensitivePath(relPath)) continue;

      if (entry.isDirectory()) {
        if (!POLYGLOT_SKIP_DIRS.has(entry.name)) {
          stack.push(relPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (
        entry.name.endsWith(".py") ||
        entry.name.endsWith(".go") ||
        entry.name.endsWith(".rs") ||
        entry.name === "pyproject.toml" ||
        entry.name === "requirements.txt" ||
        entry.name === "go.mod" ||
        entry.name === "Cargo.toml"
      ) {
        results.push(relPath);
      }
    }
  }

  return results.sort();
}

function safeReadUtf8(root: string, relPath: string): string | null {
  try {
    const full = join(root, relPath);
    const st = lstatSync(full);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > MAX_POLYGLOT_FILE_BYTES
    ) {
      return null;
    }
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

function resolvePythonTarget(
  fromRel: string,
  moduleSpec: string,
  leadingDots: number,
  pyFileSet: ReadonlySet<string>,
): string | null {
  let baseDir = posix.dirname(fromRel);
  if (baseDir === ".") baseDir = "";

  if (leadingDots > 0) {
    let dir = baseDir;
    for (let i = 1; i < leadingDots; i += 1) {
      dir = posix.dirname(dir);
      if (dir === ".") dir = "";
    }
    const modPath = moduleSpec.replace(/\./g, "/");
    const prefix = [dir, modPath].filter(Boolean).join("/");
    for (const candidate of [`${prefix}.py`, `${prefix}/__init__.py`]) {
      if (pyFileSet.has(candidate)) return candidate;
    }
    return null;
  }

  const modPath = moduleSpec.replace(/\./g, "/");
  for (const candidate of [
    `${modPath}.py`,
    `${modPath}/__init__.py`,
    `src/${modPath}.py`,
    `src/${modPath}/__init__.py`,
  ]) {
    if (pyFileSet.has(candidate)) return candidate;
  }
  return null;
}

function observePolyglotArchitecture(
  root: string,
  add: (edge: ObservedEdge) => void,
) {
  const files = walkPolyglotFiles(root);
  if (files.length === 0) return;

  const pyFiles = new Set(files.filter((f) => f.endsWith(".py")));
  const goFiles = files.filter((f) => f.endsWith(".go"));
  const rsFiles = new Set(files.filter((f) => f.endsWith(".rs")));

  // Go module root from root go.mod (if present)
  let goModuleName: string | null = null;
  if (files.includes("go.mod")) {
    const goMod = safeReadUtf8(root, "go.mod");
    const modMatch = goMod?.match(/^\s*module\s+(\S+)/m);
    if (modMatch?.[1]) {
      goModuleName = modMatch[1].trim();
    }
  }

  for (const relPath of files) {
    const text = safeReadUtf8(root, relPath);
    if (text === null) continue;

    // 1. Python manifests
    if (
      relPath.endsWith("requirements.txt") ||
      relPath.endsWith("pyproject.toml")
    ) {
      for (const [modKey, sdkName] of PYTHON_AI_SDKS) {
        const pkgPattern = modKey.replace(/[._]/g, "[-_.]");
        if (
          new RegExp(`(^|[^a-z0-9_-])${pkgPattern}([^a-z0-9_-]|$)`, "i").test(
            text,
          )
        ) {
          add({ from: relPath, to: sdkName, kind: "sdk" });
        }
      }
      continue;
    }

    // 2. Go manifest
    if (relPath.endsWith("go.mod")) {
      for (const sdk of GO_AI_SDKS) {
        if (text.includes(sdk.prefix)) {
          add({ from: relPath, to: sdk.name, kind: "sdk" });
        }
      }
      continue;
    }

    // 3. Rust manifest
    if (relPath.endsWith("Cargo.toml")) {
      for (const [crateKey, sdkName] of RUST_AI_CRATES) {
        if (
          new RegExp(`^\\s*${crateKey.replace(/-/g, "[-_]")}\\s*=`, "m").test(
            text,
          )
        ) {
          add({ from: relPath, to: sdkName, kind: "sdk" });
        }
      }
      continue;
    }

    // 4. Python source (.py)
    if (relPath.endsWith(".py")) {
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, "").trim();
        if (!line) continue;

        const fromMatch = /^from\s+(\.*)([A-Za-z0-9_.]*)\s+import\s+(.+)$/.exec(
          line,
        );
        if (fromMatch) {
          const dots = fromMatch[1]?.length ?? 0;
          const modSpec = fromMatch[2] ?? "";
          const importedList = fromMatch[3] ?? "";
          const fullSpec =
            dots === 0 && modSpec === "google" && /\bgenai\b/.test(importedList)
              ? "google.genai"
              : modSpec;

          if (dots === 0 && fullSpec) {
            const rootPkg = fullSpec.split(".")[0]!;
            const sdk =
              PYTHON_AI_SDKS.get(fullSpec) ?? PYTHON_AI_SDKS.get(rootPkg);
            if (sdk) add({ from: relPath, to: sdk, kind: "sdk" });
            const boundary = PYTHON_BOUNDARY_MODULES.get(rootPkg);
            if (boundary) {
              add({ from: relPath, to: rootPkg, kind: "boundary", boundary });
            }
          }

          const resolved = resolvePythonTarget(relPath, modSpec, dots, pyFiles);
          if (resolved && resolved !== relPath) {
            add({ from: relPath, to: resolved, kind: "import" });
          } else {
            for (const sub of importedList.split(",")) {
              const cleanSub =
                sub
                  .trim()
                  .split(/\s+as\s+/)[0]
                  ?.trim() ?? "";
              if (!cleanSub || cleanSub === "*") continue;
              const combinedSpec = modSpec
                ? `${modSpec}.${cleanSub}`
                : cleanSub;
              const subTarget = resolvePythonTarget(
                relPath,
                combinedSpec,
                dots,
                pyFiles,
              );
              if (subTarget && subTarget !== relPath) {
                add({ from: relPath, to: subTarget, kind: "import" });
              }
            }
          }
          continue;
        }

        const importMatch = /^import\s+(.+)$/.exec(line);
        if (importMatch?.[1]) {
          for (const part of importMatch[1].split(",")) {
            const modSpec =
              part
                .trim()
                .split(/\s+as\s+/)[0]
                ?.trim() ?? "";
            if (!modSpec) continue;
            const rootPkg = modSpec.split(".")[0]!;
            const sdk =
              PYTHON_AI_SDKS.get(modSpec) ?? PYTHON_AI_SDKS.get(rootPkg);
            if (sdk) add({ from: relPath, to: sdk, kind: "sdk" });
            const boundary = PYTHON_BOUNDARY_MODULES.get(rootPkg);
            if (boundary) {
              add({ from: relPath, to: rootPkg, kind: "boundary", boundary });
            }
            const resolved = resolvePythonTarget(relPath, modSpec, 0, pyFiles);
            if (resolved && resolved !== relPath) {
              add({ from: relPath, to: resolved, kind: "import" });
            }
          }
        }
      }
      continue;
    }

    // 5. Go source (.go)
    if (relPath.endsWith(".go")) {
      const importStrings = text.matchAll(/"([^"\s]+)"/g);
      for (const match of importStrings) {
        const spec = match[1];
        if (!spec) continue;
        for (const sdk of GO_AI_SDKS) {
          if (spec === sdk.prefix || spec.startsWith(`${sdk.prefix}/`)) {
            add({ from: relPath, to: sdk.name, kind: "sdk" });
          }
        }
        if (
          goModuleName &&
          spec.startsWith(`${goModuleName}/`) &&
          spec.length > goModuleName.length + 1
        ) {
          const pkgRelDir = spec.slice(goModuleName.length + 1);
          const matchedGoFiles = goFiles.filter(
            (gf) => posix.dirname(gf) === pkgRelDir && !gf.endsWith("_test.go"),
          );
          if (matchedGoFiles.length > 0) {
            for (const targetGo of matchedGoFiles) {
              if (targetGo !== relPath) {
                add({ from: relPath, to: targetGo, kind: "import" });
              }
            }
          } else {
            add({ from: relPath, to: pkgRelDir, kind: "import" });
          }
        }
      }
      continue;
    }

    // 6. Rust source (.rs)
    if (relPath.endsWith(".rs")) {
      const crateDir = relPath.includes("/src/")
        ? relPath.slice(0, relPath.indexOf("/src/") + 4)
        : dirname(relPath) === "."
          ? ""
          : dirname(relPath);

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/\/\/.*$/, "").trim();
        if (!line) continue;

        const useMatch = /^(?:pub\s+)?use\s+([A-Za-z0-9_:]+)/.exec(line);
        if (useMatch?.[1]) {
          const segs = useMatch[1].split("::");
          const first = segs[0]!;
          const sdk = RUST_AI_CRATES.get(first);
          if (sdk) {
            add({ from: relPath, to: sdk, kind: "sdk" });
          } else if (first === "crate" && segs[1]) {
            const modName = segs[1];
            const candidates = crateDir
              ? [`${crateDir}/${modName}.rs`, `${crateDir}/${modName}/mod.rs`]
              : [`src/${modName}.rs`, `src/${modName}/mod.rs`, `${modName}.rs`];
            for (const cand of candidates) {
              if (rsFiles.has(cand) && cand !== relPath) {
                add({ from: relPath, to: cand, kind: "import" });
                break;
              }
            }
          }
        }
      }
    }
  }
}

export function observeArchitecture(root: string): ObservedEdge[] {
  const edges = new Map<string, ObservedEdge>();
  const add = (edge: ObservedEdge) => {
    if (isSensitivePath(edge.from) || isSensitivePath(edge.to)) return;
    edges.set(JSON.stringify(edge), edge);
  };
  const { content } = inventoryRepository({
    repositoryPath: root,
    deniedDirectories: [join(root, ".anvilmark")],
    onLocalImport: (from, to) => add({ from, to, kind: "import" }),
  });
  for (const observation of content.observations) {
    const from = observation.location.path;
    if (observation.kind === "provider_call") {
      const { provider, endpoint } = observation;
      const to =
        endpoint.provider ??
        endpoint.host ??
        (endpoint.selection === "default" ? provider : "unresolved provider");
      add({ from, to, kind: "provider" });
    }
    if (observation.kind === "sdk_import") {
      const { package: to, category, recognizer } = observation;
      if (category === "boundary") {
        add({ from, to, kind: "boundary", boundary: recognizer ?? to });
      } else {
        add({ from, to, kind: "sdk" });
      }
    }
  }
  for (const dependency of content.inventory.ai_dependencies) {
    if (dependency.category === "other") continue;
    add({ from: dependency.manifest, to: dependency.name, kind: "sdk" });
  }

  observePolyglotArchitecture(root, add);

  return [...edges.keys()].sort().map((key) => edges.get(key)!);
}

export function matchesEndpoint(label: string, actual: string): boolean {
  const expected = label.trim().replace(/^\.\//, "").replace(/\/$/, "");
  return expected === actual || actual.startsWith(expected + "/");
}

export function matchesFlow(flow: Flow, edge: ObservedEdge): boolean {
  return (
    matchesEndpoint(flow.from, edge.from) && matchesEndpoint(flow.to, edge.to)
  );
}
