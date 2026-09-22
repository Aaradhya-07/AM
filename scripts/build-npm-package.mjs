#!/usr/bin/env node
// Builds the single installable `anvilmark` package from this workspace.
//
// Users should not have to clone a pnpm monorepo to run one command, so the
// workspace packages are bundled into the published artifact and only the
// genuinely external runtime dependencies stay as dependencies. Run after
// `pnpm build`; pass --pack to produce a tarball for local verification.
//
// This script never publishes. Publishing is a separate, deliberate act.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "dist-npm");
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

/**
 * Left as real dependencies: the TypeScript compiler the scanner runs, the
 * schema and YAML libraries whose licences travel with them, and the MCP
 * server the two MCP binaries speak. Everything under @anvilmark is bundled.
 */
const EXTERNAL = [
  "typescript",
  "zod",
  "js-yaml",
  "@modelcontextprotocol/server",
];

const ENTRIES = [
  { bin: "anvilmark", from: "packages/cli/dist/bin.js", out: "anvilmark.mjs" },
  {
    bin: "anvilmark-project-mcp",
    from: "packages/mcp/dist/project-server.js",
    out: "anvilmark-project-mcp.mjs",
  },
  {
    bin: "anvilmark-mcp",
    from: "packages/mcp/dist/server.js",
    out: "anvilmark-mcp.mjs",
  },
];

function versionOf(name) {
  // Only real package directories: the workspace folder also collects stray
  // files such as .DS_Store, which are not packages.
  const manifests = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((path) => existsSync(join(root, path)));
  for (const path of manifests) {
    const manifest = read(path);
    const found = { ...manifest.dependencies, ...manifest.devDependencies }[
      name
    ];
    if (found) return found;
  }
  const rootManifest = read("package.json");
  const found = { ...rootManifest.devDependencies }[name];
  if (found) return found;
  throw new Error(`No version range found for ${name}`);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "bin"), { recursive: true });

for (const entry of ENTRIES) {
  execFileSync(
    join(root, "node_modules/.bin/esbuild"),
    [
      join(root, entry.from),
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node20",
      ...EXTERNAL.map((name) => `--external:${name}`),
      // Bundled ESM needs these CommonJS-interop shims available by name.
      "--banner:js=import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);",
      `--outfile=${join(staging, "bin", entry.out)}`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  // The compiled entry already carries a shebang, which esbuild keeps wherever
  // the banner leaves it. Exactly one must survive, on the first line.
  const file = join(staging, "bin", entry.out);
  const body = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("#!"))
    .join("\n");
  writeFileSync(file, `#!/usr/bin/env node\n${body}`);
}

const cli = read("packages/cli/package.json");
writeFileSync(
  join(staging, "package.json"),
  `${JSON.stringify(
    {
      name: "anvilmark",
      version: cli.version,
      description:
        "Local-first decision and conformance contracts for AI systems: inventory what AI a repository uses, and check it against approved decisions.",
      license: "Apache-2.0",
      type: "module",
      // npm's own normalizer strips a leading "./" from bin paths and warns
      // loudly about it at publish time, so write the form it accepts.
      bin: Object.fromEntries(
        ENTRIES.map((entry) => [entry.bin, `bin/${entry.out}`]),
      ),
      files: ["bin", "README.md", "LICENSE"],
      engines: { node: ">=20" },
      dependencies: Object.fromEntries(
        EXTERNAL.map((name) => [name, versionOf(name)]),
      ),
      keywords: [
        "ai",
        "llm",
        "inventory",
        "conformance",
        "governance",
        "static-analysis",
      ],
      repository: {
        type: "git",
        url: "git+https://github.com/N6118/ANVILMARK.git",
      },
    },
    null,
    2,
  )}\n`,
);

cpSync(join(root, "LICENSE"), join(staging, "LICENSE"));
cpSync(join(root, "docs/npm-readme.md"), join(staging, "README.md"));

if (process.argv.includes("--pack")) {
  const output = execFileSync("npm", ["pack", "--json"], {
    cwd: staging,
    encoding: "utf8",
  });
  const [packed] = JSON.parse(output);
  // A publishable ANVILMARK package is three bundled binaries plus a manifest,
  // a readme and a licence. Anything dramatically larger means the wrong
  // directory was packed, which is one careless `cd` away from publishing the
  // whole repository.
  if (packed.entryCount > 10 || packed.unpackedSize > 8 * 1024 * 1024) {
    process.stderr.write(
      `Refusing this package: ${packed.entryCount} files, ${(packed.unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked. ` +
        `Expected at most 10 files and 8 MB. Check that dist-npm/ holds only the bundled binaries.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `${packed.filename}  ${(packed.size / 1024 / 1024).toFixed(2)} MB unpacked ${(packed.unpackedSize / 1024 / 1024).toFixed(2)} MB  ${packed.entryCount} files\n`,
  );
} else {
  process.stdout.write(`Staged ${staging}\n`);
}
