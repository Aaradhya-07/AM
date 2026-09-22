import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactOf,
  atlas,
  callIn,
  cleanup,
  materialize,
  scan,
} from "./helpers.js";
import {
  defaultRecognizers,
  readArtifact,
  serializeArtifact,
} from "../src/index.js";

afterEach(cleanup);

const prelude = `import OpenAI from "openai";
import {readTicket} from "./tickets.js";
import {redactTicket} from "./redact.js";
const client = new OpenAI();
`;
const raw = 'readTicket("synthetic")';
const clean = `redactTicket(${raw})`;
const send =
  'return client.responses.create({model:"gpt-4o-mini", input:value});';

async function fixture(source: string) {
  const root = await materialize("direct-call");
  await writeFile(join(root, "src/classify.ts"), prelude + source);
  const program = ts.createProgram([join(root, "src/classify.ts")], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  });
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
  ).toEqual([]);
  const contract = await atlas();
  const outcome = scan(root, contract);
  return { root, contract, outcome, artifact: artifactOf(outcome) };
}

describe("R1: alternative expression side effects", () => {
  it.each([
    "flag && (value = redactTicket(value))",
    "flag || (value = redactTicket(value))",
    "flag ?? (value = redactTicket(value))",
    "flag ? 0 : (value = redactTicket(value))",
    "flag ? (value = redactTicket(value)) : 0",
    "guard &&= (value = redactTicket(value))",
    "guard ||= (value = redactTicket(value))",
    "guard ??= (value = redactTicket(value))",
  ])("retains the raw skipped path for %s", async (expression) => {
    const { artifact } = await fixture(
      `export function test(flag: boolean | null) {let guard: unknown = flag; let value = ${raw}; ${expression}; ${send}}`,
    );
    const { flow } = callIn(artifact, "test");
    expect(flow.status).toBe("raw_reaches");
    expect(
      flow.contexts
        .flatMap((c) => c.facts)
        .filter((f) => f.state === "raw")
        .every((f) => f.conditional),
    ).toBe(true);
  });

  it("tracks sink execution conditions and definite literal branches", async () => {
    const { artifact } = await fixture(`
export function guarded(flag: boolean) { flag && client.responses.create({model:"gpt-4o-mini",input:${raw}}); }
export function certain() { let value = ${raw}; true && (value = redactTicket(value)); ${send} }
export function skipped() { let value = ${raw}; false && (value = redactTicket(value)); ${send} }
`);
    expect(
      callIn(artifact, "guarded")
        .flow.contexts.flatMap((c) => c.facts)
        .every((f) => f.conditional),
    ).toBe(true);
    expect(callIn(artifact, "certain").flow.status).toBe("sanitized_only");
    expect(callIn(artifact, "skipped").flow.status).toBe("raw_reaches");
  });
});

describe("R2: alias identities and writes", () => {
  it("does not treat mutated module objects as immutable initializers", async () => {
    const { artifact } = await fixture(`
const request={model:"gpt-4o-mini",input:${clean}};
request.input=${raw};
export function moduleObject(){return client.responses.create(request);}
`);
    expect(callIn(artifact, "moduleObject").flow.status).toBe("unresolved");
    expect(callIn(artifact, "moduleObject").flow.unknown_reasons).toContain(
      "captured_variable_not_tracked",
    );
  });
  it.each([
    `const request = {input:${clean}}; const alias = request; alias.input = ${raw}; const value = request.input;`,
    `const request = {message:{input:${clean}}}; request.message.input = ${raw}; const value = request.message.input;`,
    `const request = {messages:[{input:${clean}}]}; request.messages[0].input = ${raw}; const value = request.messages[0].input;`,
    `const request = {message:{input:${clean}}}; const {message} = request; message.input = ${raw}; const value = request.message.input;`,
    `const request = {input:${clean}}; const alias = request; if(flag) alias.input = ${raw}; const value = request.input;`,
    `const request = {input:${clean}}; const alias = request; flag && (alias.input = ${raw}); const value = request.input;`,
  ])("propagates a write through the actual object: %s", async (body) => {
    const { artifact } = await fixture(
      `export function test(flag: boolean) { ${body} ${send} }`,
    );
    expect(callIn(artifact, "test").flow.status).toBe("raw_reaches");
  });

  it("distinguishes a variable rebound from an object mutation and follows direct-call mutations", async () => {
    const { artifact } = await fixture(`
function mutate(request:{input:string}) {request.input = ${raw};}
export function direct() {const request={input:${clean}}; mutate(request); const value=request.input; ${send}}
export function rebound() {const request={input:${clean}}; let alias=request; alias={input:${raw}}; const value=request.input; ${send}}
export function cleared() {const request={input:${raw}}; const alias=request; alias.input=redactTicket(alias.input); const value=request.input; ${send}}
`);
    expect(callIn(artifact, "direct").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "rebound").flow.status).toBe("sanitized_only");
    expect(callIn(artifact, "cleared").flow.status).toBe("sanitized_only");
  });
});

describe("R3: mutable request configuration", () => {
  it.each([
    'request.model="unapproved-model";',
    'const alias=request; alias.model="unapproved-model";',
    'if(flag) request.model="unapproved-model";',
    'function escape(r:{model:string}) {r.model="unapproved-model";} escape(request);',
  ])("never reports a stale model literal after %s", async (mutation) => {
    const { artifact } = await fixture(
      `export function test(flag: boolean) {const request={model:"gpt-4o-mini",input:${raw}}; ${mutation} return client.responses.create(request);}`,
    );
    expect(callIn(artifact, "test").call.model).toEqual({
      kind: "runtime_selected",
    });
  });

  it("retains an immutable model and invalidates mutated endpoint options", async () => {
    const { artifact } = await fixture(`
export function literal() { const request={model:"gpt-4o-mini",input:${raw}}; return client.responses.create(request); }
export function endpoint(flag:boolean) {const options={baseURL:"https://example.invalid"}; if(flag) options.baseURL="https://other.invalid"; const c=new OpenAI(options); return c.responses.create({model:"gpt-4o-mini",input:${raw}});}
`);
    expect(callIn(artifact, "literal").call.model).toEqual({
      kind: "literal",
      value: "gpt-4o-mini",
    });
    expect(
      artifact.observations.find(
        (o) =>
          o.kind === "client_instantiation" && o.location.symbol === "endpoint",
      ),
    ).toMatchObject({ endpoint: { selection: "runtime_selected" } });
  });
});

describe("R4: additions are snapshot changes", () => {
  it.each(["src/late.ts", "tsconfig.json", "package.json"])(
    "detects new %s",
    async (path) => {
      const root = await materialize("direct-call");
      const { unlink } = await import("node:fs/promises");
      if (path !== "src/late.ts") await unlink(join(root, path));
      const outcome = scan(root, await atlas());
      await writeFile(
        join(root, path),
        path.endsWith(".json") ? "{}" : "export const late = 1;",
      );
      expect(outcome.recheck()).toContain(path);
    },
  );

  it("detects a formerly unresolved module becoming available", async () => {
    const root = await materialize("direct-call");
    await writeFile(
      join(root, "src/extra.ts"),
      'import {x} from "late-package"; export const value=x;',
    );
    const outcome = scan(root, await atlas());
    await mkdir(join(root, "node_modules/late-package"), { recursive: true });
    await writeFile(
      join(root, "node_modules/late-package/index.d.ts"),
      "export declare const x: string;",
    );
    expect(
      outcome.recheck().some((path) => path.includes("late-package")),
    ).toBe(true);
  });

  it("keeps unchanged input snapshots stable", async () => {
    const { root, contract, outcome } = await fixture(
      `export function test() { const value=${clean}; ${send} }`,
    );
    const source = await readFile(join(root, "src/classify.ts"), "utf8");
    expect(outcome.recheck()).toEqual([]);
    expect(scan(root, contract).contentHash).toBe(outcome.contentHash);
    expect(await readFile(join(root, "src/classify.ts"), "utf8")).toBe(source);
  });
});

describe("SDK request inputs versus local controls", () => {
  it("rejects old artifact meanings and hashes recognizer configuration", async () => {
    const { root, contract, artifact, outcome } = await fixture(
      `export function test(){const value=${clean}; ${send}}`,
    );
    const old = {
      ...artifact,
      format: "anvilmark-repository-scan/0.1.0-draft.1",
    };
    expect(readArtifact(JSON.stringify(old))).toMatchObject({
      status: "invalid",
      problem: expect.stringContaining("unsupported format"),
    });
    expect(readArtifact(serializeArtifact(artifact)).status).toBe("valid");
    const recognizers = defaultRecognizers();
    const changed = {
      ...recognizers,
      providers: recognizers.providers.map((provider) => ({
        ...provider,
        basis: provider.basis + " revised",
      })),
    };
    const after = scan(root, contract, undefined, { recognizers: changed });
    expect(after.contentHash).not.toBe(outcome.contentHash);
    expect(after.content.scanner.recognizer_configuration_hash).not.toBe(
      outcome.content.scanner.recognizer_configuration_hash,
    );
    expect(
      artifact.data_flows.every(
        (flow) => flow.transport_scope === "modeled_request_inputs",
      ),
    ).toBe(true);
  });
  it("excludes local controls, includes headers, and respects body replacement", async () => {
    const { artifact } = await fixture(`
export function localControl() {return client.responses.create({model:"gpt-4o-mini",input:${clean}}, {timeout:${raw}.length});}
export function header() {return client.responses.create({model:"gpt-4o-mini",input:${clean}}, {headers:{"x-ticket":${raw}}});}
export function override() {return client.responses.create({model:"gpt-4o-mini",input:${raw}}, {body:{model:"replacement",input:${clean}}});}
export function unknownTransform() {return client.responses.create({model:"gpt-4o-mini",input:${clean}}, {httpAgent:{privateData:${raw}}});}
export function dynamicOptions(options:{headers:Record<string,string>}) {return client.responses.create({model:"gpt-4o-mini",input:${clean}}, options);}
`);
    expect(callIn(artifact, "localControl").flow.status).toBe("sanitized_only");
    expect(callIn(artifact, "header").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "override").flow.status).toBe("sanitized_only");
    expect(callIn(artifact, "override").call.model).toEqual({
      kind: "literal",
      value: "replacement",
    });
    for (const name of ["unknownTransform", "dynamicOptions"]) {
      expect(callIn(artifact, name).flow.status).toBe("unresolved");
      expect(callIn(artifact, name).flow.unknown_reasons).toContain(
        "request_transport_unresolved",
      );
    }
  });

  it("does not lose array mutation or unknown object escapes", async () => {
    const { artifact } = await fixture(`
export function pushed() {const messages=[{role:"user",content:${clean}}]; messages.push({role:"user",content:${raw}}); return client.chat.completions.create({model:"gpt-4o-mini",messages});}
export function escaped(change:(x:{input:string})=>void) {const request={model:"gpt-4o-mini",input:${clean}}; change(request); return client.responses.create(request);}
`);
    expect(callIn(artifact, "pushed").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "escaped").flow.status).toBe("unresolved");
  });
});
