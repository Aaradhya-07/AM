# ANVILMARK Quickstart

This guide takes you from zero setup to a first conformance verdict on your own
TypeScript or JavaScript repository.

Every command runs locally. ANVILMARK never executes your application code,
scripts, builds, or plugins, holds no API keys, downloads no models, and sends
nothing across the network.

---

## Supported Scope and Limits

ANVILMARK analyzes code using the TypeScript compiler API (`ts.Program` with
`allowJs`).

- **Languages**: TypeScript and JavaScript only.
- **Provider Recognizers**:
  - `openai`: package `openai`, clients `OpenAI` and `AzureOpenAI` (endpoint options `baseURL`, `endpoint`); methods under `resources/`; default deployment `managed_api`.
  - `anthropic`: package `@anthropic-ai/sdk`, client `Anthropic` (endpoint option `baseURL`); methods under `resources/`.
  - `together`: package `together-ai`, client `Together` (endpoint option `baseURL`); methods under `resources/`.
  - `ollama`: package `ollama`, client `Ollama` (endpoint option `host`); operations `chat`, `generate`, `embed`; default deployment `local`.
  - `ai-sdk`: package `ai`: `generateText`, `streamText`, `generateObject`, `streamObject`, `embed`, `embedMany`, with endpoint and model read from the `model:` factory call (`@ai-sdk/*`, `ollama-ai-provider`).
  - `http`: `fetch` calls to known provider hosts (e.g. `api.openai.com`), with HTTP method and path as operation, and model read from literal JSON request bodies.
- **Boundary Recognizers**:
  - `queues`: `bullmq`, `bull`, `amqplib`, `kafkajs`, `@aws-sdk/client-sqs`, `@google-cloud/pubsub`.
  - `databases`: `pg`, `mysql2`, `mongodb`, `mongoose`, `ioredis`, `redis`, `@prisma/client`, `better-sqlite3`, `sqlite3`, `knex`, `drizzle-orm`.
  - `node-events-and-processes`: ambient `events`, `worker_threads`, `child_process`; globals `postMessage`, `BroadcastChannel`, `MessagePort`, `Worker`.
  - `network`: `axios`, `got`, `node-fetch`, `undici`, `ky`; ambient `http`, `https`, `net`, `http2`; globals `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`.
- **Unsupported AI SDKs**:
  - Packages without a dedicated recognizer (such as `@google/generative-ai`, `@google/genai`, `@mistralai/mistralai`, `groq-sdk`, `@openai/agents*`, `@langchain/*`, `llamaindex`) are reported as `unsupported_provider_sdk` unknowns. They are never silently ignored.
- **Boundaries**:
  - Links and imports leaving the repository, `.env` files, build directories (`dist/`), `vendor/`, `node_modules/` sources, and `.anvilmark/` are not read.
  - Environment variable values are never read (only variable names are recorded where AI SDKs are initialized).

---

## 1. Inventory AI Usage (Zero Configuration)

Run `inventory` from the root of your repository. It requires no project, no
contract, and no configuration:

```bash
npx anvilmark@next inventory .
```

Against a real application (e.g. `openai-responses-starter-app`), this produces:

```text
AI usage inventory: .
  55 source files analysed; snapshot sha256:7d4900c4f55a1033642932e51aa7741f6f654075246d808282daf13610f92a0f

Where requests go (7 provider calls)
  openai  7 calls  api.openai.com  data_upload, inference, management  via http, openai

Models
  gpt-5.2    1 call   -> openai
  not given  2 calls  -> openai

Call sites
  app/api/container_files/content/route.ts:15 GET  http http.request [management] -> openai
  app/api/turn_response/route.ts:17 POST  openai responses.create [inference] -> openai, model gpt-5.2
  app/api/vector_stores/add_file/route.ts:8 POST  openai vectorStores.files.create [data_upload] -> openai, model none
  app/api/vector_stores/create_store/route.ts:8 POST  openai vectorStores.create [management] -> openai
  app/api/vector_stores/list_files/route.ts:10 GET  openai vectorStores.files.list [management] -> openai
  app/api/vector_stores/retrieve_store/route.ts:9 GET  openai vectorStores.retrieve [management] -> openai
  app/api/vector_stores/upload_file/route.ts:13 POST  openai files.create [data_upload] -> openai, model none

AI dependencies
  openai  ^4.87.3 (installed 4.89.0)  package.json

Environment variables read where AI SDKs are used (names only)
  OPENAI_API_KEY  app/api/container_files/content/route.ts

Uncertain beyond the call sites above: 2 locations
  network requests whose destination was not established: 2 (unmodelled_network_hop)
  app/api/functions/get_weather/route.ts:8 unmodelled_network_hop (network)
  app/api/functions/get_weather/route.ts:22 unmodelled_network_hop (network)

Scan: incomplete (204 unknowns overall, 2 about AI calls, endpoints, models or SDKs; limits 0; analysis errors 0)
This inventory lists the AI provider usage the scanner recognized in TypeScript and JavaScript source. It is not proof that nothing else reaches an AI provider: SDKs without a recognizer, other languages, and calls whose endpoint or client could not be established are listed as unsupported or uncertain, not inventoried.
```

The inventory lists detected provider calls, literal models, dependencies,
environment-variable names read where SDKs are used, and explicit unknowns. It
writes nothing and makes no conformance claims.

---

## 2. Initialize a Project Contract

Initialize an ANVILMARK contract under `.anvilmark/` by naming your idea and
referencing the repository:

```bash
npx anvilmark@next init --idea "Starter app demonstrating OpenAI Responses API and vector stores" --repo .
```

Real output:

```text
Initialized ANVILMARK project "openai-responses-starter-app" (openai-responses-starter-app) in /path/to/repo/.anvilmark
Saved state revision r1: initialized from an idea with repository reference(s) .
Intelligence: none. No credential is stored in the project.
Not yet provided: users, outcomes, non-goals, workloads, constraints, priority order, hardware, budgets, candidates, decisions
Next: anvilmark status, then anvilmark elicit (or the add commands in anvilmark help)
```

The repository path is recorded. Its contents are not transmitted anywhere, and
no credentials are ever stored.

---

## 3. Draft Scanner Declarations

Use `scan draft-config` to generate a starter declaration file based on the
observed provider calls.

> **Note**: In POSIX shells (`bash`, `zsh`), redirecting directly to
> `.anvilmark/scanner.yaml` creates a 0-byte file before the process runs,
> causing the scanner to read an empty configuration. Redirect to a temporary
> file first and move it into place:

```bash
npx anvilmark@next scan draft-config > .anvilmark/scanner.yaml.tmp && mv .anvilmark/scanner.yaml.tmp .anvilmark/scanner.yaml
```

The generated `.anvilmark/scanner.yaml` contains observed sinks, commented
component suggestions, and candidate placeholders:

```yaml
format: anvilmark-scan-config/0.1.0-draft.2
repository_root: "."

# Observed provider calls:
#   app/api/container_files/content/route.ts:15 http http.request [management] -> openai, model absent
#   app/api/turn_response/route.ts:17 openai responses.create [inference] -> openai, model gpt-5.2
#   ...

sources: []

sanitizers: []

sinks:
  - id: sink.http
    recognizer: "http"
    paths: ["app/api/container_files/content"]
  - id: sink.openai
    recognizer: "openai"
    paths: ["app/api"]

components: []
```

---

## 4. Run the Repository Scan

Run `scan` to produce `.anvilmark/scans/repository-scan.json`:

```bash
npx anvilmark@next scan
```

Real output:

```text
Repository scan written: .anvilmark/scans/repository-scan.json
  repository:   .  snapshot sha256:7d4900c4f55a1033642932e51aa7741f6f654075246d808282daf13610f92a0f
  contract:     openai-responses-starter-app revision 1 (state r1)  sha256:d914bd2f16f8d0fb91c0a76f694a7e38bc0b6082c41942079f9d46274eea3ffe
  declarations: .anvilmark/scanner.yaml
  scanner:      anvilmark-scanner 0.1.0-draft.3, TypeScript 5.9.3, flow bounded-direct-call/3 (call depth 3)
  observed_at:  2026-09-19T10:19:38.059Z (clock)
  inventory:    55 source file(s), 1 AI SDK dependency, 4 exclusion(s)
  observed:     6 client instantiation(s), 7 provider call(s)
  data reaching provider calls: 0 raw_reaches, 7 unresolved, 0 sanitized_only, 0 no_declared_data
  proposed bindings: 7 (0 declared_mapping, 0 heuristic_association, 7 unresolved)
  unknowns: 204 (2 about AI calls, declared data or imports)   analysis errors: 0   limits: 0
  completeness: incomplete (204 unknown(s))
  These are observations and proposed bindings, not conformance results.
  Inspect with "anvilmark scan show --section observations|flows|bindings|unknowns".
```

You can inspect the scan details at any time with `npx anvilmark@next scan show`.

---

## 5. Declare Architecture, Workload, and Candidate

Conformance checks compare code against declared policy. To test conformance for
the chat feature:

1. **Add an architecture service node**:

   ```bash
   npx anvilmark@next architecture node add web-app --kind service --name "Web App" --trust-boundary local
   ```

   ```text
   Saved state revision r2: added architecture node web-app (service, local)
     notice: web-app is declared structure; it has no linked decision until you bind one
   ```

2. **Declare the workload**:

   ```bash
   npx anvilmark@next workload add --id chat --name "Chat Assistant" --input user_message --output plain_text
   ```

   ```text
   Saved state revision r3: added workload chat
     notice: monthly usage of chat is recorded as unknown; projected cost and token comparisons for it stay unknown until "anvilmark workload usage chat --calls-per-month N" supplies a volume
     notice: the output data classification of chat is not declared (unknown); set it with "anvilmark workload output-classification chat LABEL"
   ```

3. **Declare the allowed candidate**:

   ```bash
   npx anvilmark@next candidate add --id candidate.chat.openai --workload chat \
     --component-kind model_runtime --mode managed_api --provider openai \
     --model gpt-5.2 --model-version gpt-5.2 --model-mutability pinned
   ```

   ```text
   Saved state revision r4: added candidate candidate.chat.openai (discovered)
   ```

---

## 6. Link Scan Declarations to the Contract

Update `.anvilmark/scanner.yaml` so the scanner knows which code implements the
workload and reaches the candidate:

1. Map the route implementation file to the `chat` workload and `web-app` node
   under `components`.
2. Map the `sink.openai` sink to `candidate.chat.openai` using `candidate_ref`.

```yaml
format: anvilmark-scan-config/0.1.0-draft.2
repository_root: "."

sources: []

sanitizers: []

sinks:
  - id: sink.http
    recognizer: "http"
    paths: ["app/api/container_files/content"]
  - id: sink.openai
    recognizer: "openai"
    paths: ["app/api"]
    candidate_ref: candidate.chat.openai

components:
  - id: component.app_api_turn_response_route
    path: "app/api/turn_response/route.ts"
    architecture_node_ref: web-app
    workload_ref: chat
```

---

## 7. Add a Conformance Rule

Add a `provider-allowlist` rule to check that the `chat` workload only calls
approved candidates:

```bash
npx anvilmark@next rule add provider-allowlist --id rule.chat.provider --workload chat --allow candidate.chat.openai
```

Real output:

```text
Saved state revision r5: added conformance rule rule.chat.provider: workload chat uses only candidate.chat.openai
```

---

## 8. Run Conformance Evaluation

Evaluate conformance against the current repository state:

```bash
npx anvilmark@next conformance
```

Real output (exit code `0`):

```text
ANVILMARK Conformance Report
  evaluated_at:     2026-09-19T10:20:59.310Z
  conformance_hash: sha256:897e9b7acd87b874051520b6b1aceaae5e218d92b854884cc039af33e67b62c8
  contract:         openai-responses-starter-app revision 1 (sha256:2e19ebebbd8dbe710fae20016aadb4c5b90994e05703707c8dc4ae8bb1790e52)
  repository:       . snapshot sha256:7d4900c4f55a1033642932e51aa7741f6f654075246d808282daf13610f92a0f
  engine:           anvilmark-conformance 0.1.0-draft.3

Results:
  [PASS] rule.chat.provider (provider_allowlist, severity: error)
      workload:    chat
      location:    app/api/turn_response/route.ts:17:26 (POST)
      explanation: Workload 'chat' invokes only the provider/model references allowed by its current candidate policy.
      caveats:     Candidate and workload associations are declared mappings; this proves only the supported SDK/model references in the selected source.; Endpoints are the SDK defaults or literal URLs in code; runtime environment overrides and network routing are not verified.; The workload is scoped to its declared component files (1); provider calls elsewhere are not attributed to it.; 204 unknown(s) were not treated as blocking: dynamic dispatch and unresolved values in scanned code cannot hide a provider call, because provider calls are recognized wherever they appear, and AI-related unknowns outside the workload's declared files are not attributed to it.

Summary: 1 rule(s) evaluated (1 pass, 0 fail, 0 unknown, 0 not applicable)
Overall Status: COMPLIANT
```

---

## What a Conformance Failure Looks Like

If the code or candidate changes such that the code invokes an unauthorized model
(for example, if the candidate specifies `gpt-4o` while the code calls
`gpt-5.2`):

```bash
npx anvilmark@next candidate model candidate.chat.openai --model gpt-4o --model-version gpt-4o --model-mutability pinned
npx anvilmark@next conformance
```

Real output (exit code `1`):

```text
ANVILMARK Conformance Report
  evaluated_at:     2026-09-19T10:21:08.164Z
  conformance_hash: sha256:6750c1cbb1b2204676892b66b959fc0070cd92b9dd292bcbd550899391a4395f
  contract:         openai-responses-starter-app revision 1 (sha256:a32dd1b390aa3a4ffcf9b16e85a7ccac935c4fe39bac3a14fcf029f7f23ca147)
  repository:       . snapshot sha256:7d4900c4f55a1033642932e51aa7741f6f654075246d808282daf13610f92a0f
  engine:           anvilmark-conformance 0.1.0-draft.3

Results:
  [FAIL] rule.chat.provider (provider_allowlist, severity: error)
      workload:    chat
      location:    app/api/turn_response/route.ts:17:26 (POST)
      explanation: Workload 'chat' invokes openai model 'gpt-5.2' (responses.create) at app/api/turn_response/route.ts:17, outside its current candidate policy (candidate_model_mismatch).
      caveats:     Candidate and workload associations are declared mappings; this proves only the supported SDK/model references in the selected source.; Endpoints are the SDK defaults or literal URLs in code; runtime environment overrides and network routing are not verified.; The workload is scoped to its declared component files (1); provider calls elsewhere are not attributed to it.; 204 unknown(s) were not treated as blocking: dynamic dispatch and unresolved values in scanned code cannot hide a provider call, because provider calls are recognized wherever they appear, and AI-related unknowns outside the workload's declared files are not attributed to it.
      suggested remediation:
        - Use allowed candidate 'candidate.chat.openai' for workload 'chat'

Summary: 1 rule(s) evaluated (0 pass, 1 fail, 0 unknown, 0 not applicable)
Overall Status: CONFORMANCE VIOLATIONS DETECTED
```

---

## The Decision Approval Flow (`approved_candidate_only`)

For teams requiring formal decision reviews and cryptographic approval hashes:

1. **Draft and Propose a Decision**:

   ```bash
   npx anvilmark@next candidate model candidate.chat.openai --model gpt-5.2 --model-version gpt-5.2 --model-mutability pinned
   npx anvilmark@next decision draft --id decision.chat --workload chat \
     --select candidate.chat.openai --rationale "Use OpenAI GPT-5.2 for chat assistant"
   npx anvilmark@next decision propose decision.chat
   ```

2. **Review the Decision**:

   ```bash
   npx anvilmark@next review decision.chat
   ```

   `review` prints the candidate details, cited evidence, the exact canonical
   JSON covered by the approval, and the SHA-256 approval hash (e.g.
   `bdf3b7149784efda82165238f7a1811f33d889e72e0477fe10beea38b0efa612`).

3. **Approve Interactively**:

   ```bash
   npx anvilmark@next approve decision.chat
   ```

   `approve` requires an interactive terminal. It prompts for your name/role and
   the first 12 characters of the approval hash:

   ```text
   Approving as (your name or role): developer

   To approve decision decision.chat revision 1 exactly as shown, type the first 12 characters of the approval hash (bdf3...). Press Enter to cancel: bdf3b7149784
   Saved state revision r8: approved decision decision.chat revision 1 (sha-256 bdf3b7149784efda82165238f7a1811f33d889e72e0477fe10beea38b0efa612)
   ```

   The approval transcript was produced through a test harness, not a real terminal.

4. **Add an Approved-Candidate Rule**:

   ```bash
   npx anvilmark@next rule add approved-candidate --id rule.chat.approved --workload chat --decision decision.chat
   ```

   Running `conformance` now verifies that the code matches the approved
   decision:

   ```text
   Results:
     [PASS] rule.chat.approved (approved_candidate_only, severity: error)
         workload:    chat
         decision:    decision.chat
         location:    app/api/turn_response/route.ts:17:26 (POST)
         explanation: Workload 'chat' invokes only the provider/model references allowed by its current candidate policy.
   ```

---

## Verifying in CI

In continuous integration, run:

```bash
# Evaluate compliance (exits 0 if compliant, 1 on violation, 2 on unknown/analysis error)
npx anvilmark@next conformance

# Verify report freshness without writing changes (exits 0 if fresh, 1 if stale/tampered)
npx anvilmark@next conformance --check
```
