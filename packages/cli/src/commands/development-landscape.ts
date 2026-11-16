import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { verifiedHandoffFiles } from "./development-handoff.js";

const exec = promisify(execFile);
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await exec("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout;
}

async function boundedTrackedFile(
  root: string,
  path: string,
  maximum = 256 * 1024,
): Promise<Buffer | null> {
  const full = resolve(root, path);
  if (!full.startsWith(`${root}/`)) return null;
  const stat = await lstat(full).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    return null;
  if (!(await realpath(full)).startsWith(`${root}/`)) return null;
  return readFile(full);
}

type Manifest = {
  path: string;
  directory: string;
  name: string;
  sha256: string;
  entrypoints: string[];
  scripts: string[];
  dependency_names: string[];
  declared_purpose: {
    text: string;
    source: string;
    source_sha256: string;
  } | null;
};

function names(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

async function manifests(
  root: string,
  paths: readonly string[],
): Promise<{
  items: Manifest[];
  unreadable: string[];
}> {
  const items: Manifest[] = [];
  const unreadable: string[] = [];
  const tracked = new Set(paths);
  for (const path of paths.filter(
    (item) =>
      item.endsWith("package.json") &&
      !item
        .split("/")
        .some((segment) =>
          ["test", "tests", "__tests__", "fixtures", "node_modules"].includes(
            segment,
          ),
        ),
  )) {
    const data = await boundedTrackedFile(root, path);
    if (!data) {
      unreadable.push(path);
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(data.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("invalid manifest");
      const value = parsed as Record<string, unknown>;
      const directory = dirname(path) === "." ? "." : dirname(path);
      const readmePath =
        directory === "." ? "README.md" : `${directory}/README.md`;
      const readme = tracked.has(readmePath)
        ? await boundedTrackedFile(root, readmePath, 64 * 1024)
        : null;
      const purpose = readme
        ? readme
            .toString("utf8")
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim().replace(/\s+/g, " "))
            .find(
              (paragraph) =>
                paragraph.length > 35 &&
                !/^(#|>|\||\[|!|```|- |\* )/.test(paragraph),
            )
        : undefined;
      const entrypoints = [value.main, value.module, value.types]
        .filter((item): item is string => typeof item === "string")
        .slice(0, 3);
      items.push({
        path,
        directory,
        name:
          typeof value.name === "string" && value.name.trim()
            ? value.name
            : directory,
        sha256: sha256(data),
        entrypoints,
        scripts: names(value.scripts).sort(),
        dependency_names: [
          ...new Set([
            ...names(value.dependencies),
            ...names(value.devDependencies),
            ...names(value.peerDependencies),
          ]),
        ].sort(),
        declared_purpose:
          purpose && readme
            ? {
                text:
                  purpose.length > 300
                    ? `${purpose.slice(0, 297).replace(/\s+\S*$/, "")}…`
                    : purpose,
                source: readmePath,
                source_sha256: sha256(readme),
              }
            : null,
      });
    } catch {
      unreadable.push(path);
    }
  }
  return { items, unreadable };
}

export interface DevelopmentLandscape {
  format: "anvilmark-development-landscape/1";
  repository: {
    root: string;
    commit: string;
    dirty: boolean;
    changed_paths: string[];
    tracked_file_count: number;
  };
  design: {
    components: Array<{
      name: string;
      directory: string;
      source: string;
      source_sha256: string;
      entrypoints: string[];
      declared_purpose: {
        text: string;
        source: string;
        source_sha256: string;
      } | null;
    }>;
    declared_dependencies: Array<{
      from: string;
      to: string;
      source: string;
    }>;
    source_areas: Array<{
      directory: string;
      file_count: number;
      examples: string[];
    }>;
    decision_documents: string[];
  };
  change_readiness: {
    requested_outcome: string | null;
    file_leads: Array<{ path: string; sha256: string; reason: string }>;
    questions: string[];
  };
  working_style: {
    languages_by_tracked_extension: Record<string, number>;
    test_file_examples: string[];
    configuration_files: string[];
    package_scripts: Array<{ source: string; names: string[] }>;
  };
  development_provenance: {
    source: ".anvilmark/development/runs";
    recorded_runs: number;
    recent_runs: Array<{
      run_id: string;
      task_id: string;
      configured_model: string;
      model_identity: string;
      tool_reported_models: string[];
      review:
        | "human_accepted"
        | "human_rejected"
        | "test_only"
        | "unreviewed_or_invalid";
      input_tokens: number | null;
      output_tokens: number | null;
      estimated_api_usd: number | null;
      billing_basis: string;
    }>;
    historical_authoring_model: "unknown_without_session_evidence";
  };
  limits: string[];
}

async function provenance(
  root: string,
): Promise<DevelopmentLandscape["development_provenance"]> {
  const location = join(root, ".anvilmark", "development", "runs");
  const result: DevelopmentLandscape["development_provenance"] = {
    source: ".anvilmark/development/runs",
    recorded_runs: 0,
    recent_runs: [],
    historical_authoring_model: "unknown_without_session_evidence",
  };
  const stat = await lstat(location).catch(() => null);
  if (!stat) return result;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("development run storage must be a real directory");
  const files = (await readdir(location))
    .filter((name) => /^[a-zA-Z0-9._-]+\.json$/.test(name))
    .sort();
  result.recorded_runs = files.length;
  for (const file of files.slice(-20)) {
    const path = join(location, file);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024)
      continue;
    let run: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      run = value as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = file.slice(0, -5);
    if (run.id !== id) continue;
    const reviewPath = join(
      root,
      ".anvilmark",
      "development",
      "reviews",
      `${id}.json`,
    );
    let review: DevelopmentLandscape["development_provenance"]["recent_runs"][number]["review"] =
      "unreviewed_or_invalid";
    const reviewInfo = await lstat(reviewPath).catch(() => null);
    if (
      reviewInfo?.isFile() &&
      !reviewInfo.isSymbolicLink() &&
      reviewInfo.size < 64 * 1024
    ) {
      try {
        const record = JSON.parse(await readFile(reviewPath, "utf8")) as Record<
          string,
          unknown
        >;
        if (
          record.run_hash === sha256(JSON.stringify(run)) &&
          record.run_id === id
        ) {
          review =
            record.actor === "agent_test_operator"
              ? "test_only"
              : record.actor === "interactive_local_operator" &&
                  record.decision === "accepted" &&
                  run.approval_at_start === "current" &&
                  run.approval_actor_at_start === "interactive_local_operator"
                ? "human_accepted"
                : record.actor === "interactive_local_operator" &&
                    record.decision === "rejected"
                  ? "human_rejected"
                  : "unreviewed_or_invalid";
        }
      } catch {
        // A malformed review is displayed as unreviewed or invalid.
      }
    }
    const modelEvents = Array.isArray(run.model_events) ? run.model_events : [];
    const usage =
      run.usage && typeof run.usage === "object" && !Array.isArray(run.usage)
        ? (run.usage as Record<string, unknown>)
        : {};
    result.recent_runs.push({
      run_id: id,
      task_id: typeof run.task_id === "string" ? run.task_id : "unknown",
      configured_model:
        typeof run.configured_model === "string"
          ? run.configured_model
          : "unknown",
      model_identity:
        typeof run.model_identity === "string" ? run.model_identity : "unknown",
      tool_reported_models: [
        ...new Set(
          modelEvents
            .map((item) =>
              item &&
              typeof item === "object" &&
              typeof (item as Record<string, unknown>).model === "string"
                ? (item as Record<string, string>).model
                : null,
            )
            .filter((item): item is string => item !== null),
        ),
      ],
      review,
      input_tokens:
        typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      output_tokens:
        typeof usage.output_tokens === "number" ? usage.output_tokens : null,
      estimated_api_usd:
        typeof run.estimated_usd_from_observed_tokens === "number"
          ? run.estimated_usd_from_observed_tokens
          : null,
      billing_basis: typeof run.billing === "string" ? run.billing : "unknown",
    });
  }
  return result;
}

function sourceArea(path: string, packageDirs: readonly string[]): string {
  const owner =
    packageDirs.find(
      (directory) => directory !== "." && path.startsWith(`${directory}/`),
    ) ?? ".";
  const inside = owner === "." ? path : path.slice(owner.length + 1);
  const parts = inside.split("/");
  const base = owner === "." ? "" : `${owner}/`;
  if (parts.length < 2) return owner;
  if (
    ["src", "app", "pages", "lib", "components", "server", "client"].includes(
      parts[0] ?? "",
    )
  )
    return `${base}${parts[0]}${parts.length > 2 ? `/${parts[1]}` : ""}`;
  return `${base}${parts[0]}`;
}

export async function developmentLandscape(
  root: string,
  goal?: string,
): Promise<DevelopmentLandscape> {
  const physicalRoot = await realpath(root);
  const repositoryRoot = (
    await git(physicalRoot, "rev-parse", "--show-toplevel")
  ).trim();
  if (repositoryRoot !== physicalRoot)
    throw new Error("--project-dir must be the Git repository root");
  const commit = (await git(physicalRoot, "rev-parse", "HEAD")).trim();
  const tracked = (await git(physicalRoot, "ls-files", "-z", "--cached"))
    .split("\0")
    .filter((path) => path && !path.startsWith(".anvilmark/"));
  const status = (
    await git(
      physicalRoot,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).anvilmark",
    )
  )
    .split("\0")
    .filter(Boolean);
  const changedPaths = status.map((entry) => entry.slice(3)).slice(0, 20);
  const packages = await manifests(physicalRoot, tracked);
  const packageNames = new Set(packages.items.map((item) => item.name));
  const languageExtensions = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
  ]);
  const languages: Record<string, number> = {};
  for (const path of tracked) {
    const extension = extname(path).toLowerCase();
    if (languageExtensions.has(extension))
      languages[extension] = (languages[extension] ?? 0) + 1;
  }
  const tests = tracked
    .filter((path) =>
      /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^.]+$/.test(path),
    )
    .slice(0, 16);
  const configs = tracked
    .filter((path) =>
      /(^|\/)(tsconfig[^/]*\.json|jsconfig[^/]*\.json|vitest[^/]*|jest[^/]*|eslint[^/]*|\.eslintrc[^/]*|prettier[^/]*|\.prettierrc[^/]*|pnpm-workspace\.yaml|pyproject\.toml|Cargo\.toml|go\.mod|Makefile)$/.test(
        path,
      ),
    )
    .slice(0, 24);
  const docs = tracked
    .filter((path) =>
      /(^|\/)(ADR[-_0-9a-zA-Z.]*|adr\/|architecture\/|docs\/architecture\/|AGENTS\.md|CLAUDE\.md|CONTRIBUTING\.md|STYLE\.md)/i.test(
        path,
      ),
    )
    .slice(0, 24);
  const components = packages.items.length
    ? packages.items.map((item) => ({
        name: item.name,
        directory: item.directory,
        source: item.path,
        source_sha256: item.sha256,
        entrypoints: item.entrypoints,
        declared_purpose: item.declared_purpose,
      }))
    : [
        ...new Set(
          tracked
            .map((path) => path.split("/")[0])
            .filter((part): part is string => Boolean(part && part !== ".")),
        ),
      ]
        .slice(0, 24)
        .map((directory) => ({
          name: directory,
          directory,
          source: directory,
          source_sha256: "",
          entrypoints: [],
          declared_purpose: null,
        }));
  const packageDirs = packages.items
    .map((item) => item.directory)
    .sort((a, b) => b.length - a.length);
  const areas = new Map<string, string[]>();
  for (const path of tracked) {
    if (!languageExtensions.has(extname(path).toLowerCase())) continue;
    const area = sourceArea(path, packageDirs);
    areas.set(area, [...(areas.get(area) ?? []), path]);
  }
  const sourceAreas = [...areas.entries()]
    .map(([directory, files]) => ({
      directory,
      file_count: files.length,
      examples: files.slice(0, 4),
    }))
    .sort(
      (a, b) =>
        b.file_count - a.file_count || a.directory.localeCompare(b.directory),
    )
    .slice(0, 30);
  const leads = goal?.trim()
    ? await verifiedHandoffFiles(physicalRoot, tracked, goal, goal, [])
    : [];
  return {
    format: "anvilmark-development-landscape/1",
    repository: {
      root: physicalRoot,
      commit,
      dirty: status.length > 0,
      changed_paths: changedPaths,
      tracked_file_count: tracked.length,
    },
    design: {
      components,
      declared_dependencies: packages.items.flatMap((item) =>
        item.dependency_names
          .filter((name) => packageNames.has(name))
          .map((name) => ({ from: item.name, to: name, source: item.path })),
      ),
      source_areas: sourceAreas,
      decision_documents: docs,
    },
    change_readiness: {
      requested_outcome: goal?.trim() || null,
      file_leads: leads.map((item) => ({
        path: item.path,
        sha256: item.sha256,
        reason: item.selection,
      })),
      questions: [
        "Which source areas and interfaces actually own this outcome?",
        "Which existing checks and human review criteria will establish completion?",
        "Are any architecture or policy decisions missing or superseded?",
      ],
    },
    working_style: {
      languages_by_tracked_extension: languages,
      test_file_examples: tests,
      configuration_files: configs,
      package_scripts: packages.items
        .filter((item) => item.scripts.length > 0)
        .map((item) => ({ source: item.path, names: item.scripts })),
    },
    development_provenance: await provenance(physicalRoot),
    limits: [
      "Component names and dependency edges come from tracked package manifests or directory names; runtime architecture and interface semantics need review.",
      "Source areas and goal-specific file leads are path-based navigation hints, not semantic ownership or a diagnosis.",
      "File paths and configuration names show working conventions but do not prove that every file follows them.",
      "Only Anvilmark development run records are inspected for model use; absent records do not mean no AI was used.",
      "Configured and tool-reported model identities are distinct; neither is independent provider attestation.",
      ...packages.unreadable.map(
        (path) => `Package manifest could not be inspected: ${path}`,
      ),
    ],
  };
}

export function renderDevelopmentLandscape(
  report: DevelopmentLandscape,
): string {
  const lines = [
    `Development landscape at ${report.repository.commit.slice(0, 12)}${report.repository.dirty ? " (working tree has changes)" : ""}`,
    `Tracked files: ${report.repository.tracked_file_count}; languages by extension: ${
      Object.entries(report.working_style.languages_by_tracked_extension)
        .map(([key, count]) => `${key} ${count}`)
        .join(", ") || "unknown"
    }.`,
    ...(report.change_readiness.requested_outcome
      ? [
          `Requested outcome: ${report.change_readiness.requested_outcome}`,
          `File leads to inspect: ${report.change_readiness.file_leads.map((item) => item.path).join(", ") || "none"}.`,
        ]
      : []),
    "Declared components and links (review their actual responsibilities):",
    ...report.design.components
      .slice(0, 20)
      .flatMap((item) => [
        `- ${item.name}: ${item.directory} (source ${item.source})`,
        ...(item.declared_purpose
          ? [
              `  Documented purpose (${item.declared_purpose.source}): ${item.declared_purpose.text}`,
            ]
          : []),
      ]),
    ...report.design.declared_dependencies
      .slice(0, 30)
      .map((item) => `  ${item.from} → ${item.to} (${item.source})`),
    "Source areas (path-based navigation hints):",
    ...report.design.source_areas
      .slice(0, 20)
      .map(
        (item) =>
          `- ${item.directory}: ${item.file_count} files; e.g. ${item.examples.join(", ")}`,
      ),
    `Decision/context documents: ${report.design.decision_documents.join(", ") || "none found"}.`,
    `Test examples: ${report.working_style.test_file_examples.join(", ") || "none found"}.`,
    `Config: ${report.working_style.configuration_files.join(", ") || "none found"}.`,
    ...report.working_style.package_scripts
      .slice(0, 12)
      .map((item) => `Scripts in ${item.source}: ${item.names.join(", ")}.`),
    `Recorded Anvilmark development runs: ${report.development_provenance.recorded_runs}. Historical authoring models outside captured sessions: unknown.`,
    ...report.development_provenance.recent_runs.map(
      (item) =>
        `- ${item.run_id}: task ${item.task_id}; configured ${item.configured_model}; ${item.model_identity}; reported ${item.tool_reported_models.join(", ") || "none"}; ${item.review}; ${item.input_tokens ?? "?"} input/${item.output_tokens ?? "?"} output tokens; ${item.estimated_api_usd === null ? "cash unknown" : `$${item.estimated_api_usd.toFixed(4)} API-rate estimate`}.`,
    ),
    "Limits:",
    ...report.limits.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}
