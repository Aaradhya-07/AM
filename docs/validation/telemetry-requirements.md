# Telemetry Requirements

What ANVILMARK needs from a customer's existing observability in order to build a traffic profile and reconstruct a cost baseline.

**Governing principle: we consume what already exists. We do not instrument anyone during validation.** A team that would need to add instrumentation to participate is recorded as a Kill 2 data point, not converted into an integration project.

**[INFERENCE]** Field names for third-party platforms and for the OpenTelemetry GenAI semantic conventions change between versions. Every mapping in this document is a **starting hypothesis to be confirmed against the customer's actual export**, not a specification to rely on. The GenAI conventions in particular have been under active revision; treat the attribute names below as a search key, not as truth.

---

## 1. Minimum event schema

One record per LLM API call — including calls that failed, were retried, or were served from cache. Those are the records most often missing, and their absence is the most common cause of a baseline that will not reconcile.

### Required fields

Without all of these, a defensible baseline cannot be built.

| Field             | Type          | Purpose                                                                | If missing                                                            |
| ----------------- | ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `call_site_id`    | string        | Stable identity of the code location making the call.                  | **Blocking.** PR-to-call-site mapping is impossible. See §2.          |
| `provider`        | string        | `openai`, `anthropic`, `google`, `bedrock`, `azure`, self-hosted, etc. | **Blocking** for pricing.                                             |
| `model`           | string        | Exact model identifier including version or snapshot.                  | **Blocking.** `gpt-4o` and `gpt-4o-2024-08-06` may price differently. |
| `timestamp_start` | RFC 3339, UTC | Call initiation.                                                       | **Blocking** for volume and concurrency.                              |
| `input_tokens`    | integer       | Prompt tokens as reported by the provider.                             | **Blocking** unless raw input text is available to count.             |
| `output_tokens`   | integer       | Completion tokens as reported by the provider.                         | **Blocking.**                                                         |
| `status`          | enum          | `success` / `error` / `timeout` / `cancelled`.                         | **Blocking.** Errors are billed by some providers and not by others.  |
| `request_id`      | string        | Provider request ID or internal trace/span ID.                         | **Blocking** for retry-chain reconstruction and deduplication.        |

### Strongly recommended

Absence of any of these does not block the engagement but **widens the stated uncertainty**, and that widening must appear in the report.

| Field                       | Type            | Purpose                                                           | Cost of absence                                                        |
| --------------------------- | --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `reasoning_tokens`          | integer         | Billed reasoning/thinking tokens on models that emit them.        | Baseline understates cost, often severely.                             |
| `cache_read_tokens`         | integer         | Tokens served from prompt cache.                                  | Baseline **overstates** cost, sometimes by a large factor.             |
| `cache_write_tokens`        | integer         | Tokens written to cache (frequently priced above standard input). | Baseline understates cost.                                             |
| `latency_ms`                | number          | End-to-end duration.                                              | Cannot assess latency impact of a change.                              |
| `retry_count` / `attempt`   | integer         | Retry position within a logical request.                          | Volume and cost double-counted. See §7.                                |
| `error_type`                | string          | Rate limit, timeout, content filter, server error.                | Cannot distinguish billed from unbilled failures.                      |
| `environment`               | enum            | `production` / `staging` / `development` / `test`.                | **High risk.** Non-production traffic silently inflates the baseline.  |
| `release_id` / `commit_sha` | string          | Deployed version at call time.                                    | **Blocking for post-deployment scoring.** See §3.                      |
| `cost_usd`                  | number          | Cost as computed by the telemetry platform.                       | Useful cross-check; never trusted over our own computation. See §6.    |
| `timestamp_end`             | RFC 3339        | Call completion.                                                  | Concurrency estimation degrades.                                       |
| `streaming`                 | boolean         | Whether the response was streamed.                                | Token accounting differs on some providers.                            |
| `tenant_id` / `feature`     | string (opaque) | Attribution dimension.                                            | Cannot segment. **Must be opaque — never a real customer identifier.** |

### Optional but valuable

| Field                                                    | Purpose                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `temperature`, `top_p`, `max_tokens`, `reasoning_effort` | Sampling parameters. Changes to these are exactly what a PR often touches.        |
| `tool_call_count`                                        | Multi-turn agent loops multiply cost non-linearly; needed to model them.          |
| `finish_reason`                                          | `length` finishes indicate truncation, which distorts output-token distributions. |
| `prompt_version`                                         | If prompts are versioned, this is a far better call-site key than a file path.    |
| `gateway`/`router`                                       | Which gateway handled the call, and any markup. See §7.                           |

### Quality and outcome signals

Requested separately, because they rarely live in the same system. Ranked by value — see the evaluation hierarchy in [`experiment-protocol.md`](experiment-protocol.md).

| Signal                                                                                                                | Value                                                                |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Deterministic correctness (schema validation, parse success, tool-call success, classification against a known label) | **Highest**                                                          |
| Existing eval suite results, with the dataset's provenance                                                            | High                                                                 |
| Explicit human feedback (thumbs, ratings, corrections, escalations)                                                   | High                                                                 |
| Downstream business outcome (ticket resolved, retry by user, conversion)                                              | High                                                                 |
| Implicit signals (regeneration rate, abandonment, edit distance)                                                      | Medium                                                               |
| Existing LLM-judge scores                                                                                             | Low — provenance and prompt must be known before any weight is given |

---

## 2. Call-site identity

**This is the hardest requirement and the most common blocker.** It is what distinguishes this method from generic cost dashboards: the analysis must connect _a line in a diff_ to _a measured population of production calls_.

Acceptable forms, in descending order of reliability:

| Form                                                                                                          | Reliability              | Notes                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| An explicit stable identifier set in code (`span.set_attribute("anvilmark.call_site", "classify_ticket_v3")`) | Highest                  | Rare, but some teams already tag calls this way.                                              |
| Prompt version or template identifier                                                                         | High                     | Survives refactoring better than file paths.                                                  |
| OTel span name plus code attributes (`code.filepath`, `code.function`)                                        | High                     | Best realistic default when spans are used.                                                   |
| Langfuse/Helicone trace name, generation name, or custom property                                             | Medium-high              | Depends on consistent naming discipline.                                                      |
| A stable request tag or header set at the call site                                                           | Medium                   | Common in gateway setups.                                                                     |
| Model plus endpoint plus prompt-prefix hash                                                                   | **Low — inference only** | A last resort. Must be flagged in the report as an inferred mapping with its own uncertainty. |
| Nothing distinguishing at all                                                                                 | **Blocking**             | Triggers the refund condition in [`design-partner-offer.md`](design-partner-offer.md).        |

**[INFERENCE]** Where mapping is inferred rather than explicit, the report must state the inference and its confidence. A cost delta computed against a misattributed call-site population is worse than no number, because it is wrong in a way the reader cannot detect.

---

## 3. Release identity — required for post-deployment scoring

Predicted-versus-actual scoring compares behaviour before and after a specific merge. That requires knowing which calls ran which code.

Acceptable: `commit_sha`, a release tag, a deployment ID, or a reliable deployment timestamp log that can partition calls into before and after.

**If none exists**, post-deployment scoring degrades to a before/after comparison across a deployment timestamp, which is confounded by every other change deployed at the same time. When that is the case the report must say so, and the scorecard's confidence must reflect it.

---

## 4. Volume and window

| Requirement              | Target                                                                      | Rationale                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Window                   | **30 days**, 14 minimum                                                     | Must span at least two weekly cycles. Weekday/weekend and business-hours variation is large.                 |
| Calls at the target site | **[ASSUMPTION]** enough to characterize the distribution, not a fixed count | The required volume depends on measured variance. See §5.                                                    |
| Billing alignment        | At least one complete provider billing period                               | Otherwise reconciliation compares different windows. See [`experiment-protocol.md`](experiment-protocol.md). |
| Completeness             | Sampled telemetry must state its sampling rate                              | Head-based sampling at 10% must be corrected for, not silently extrapolated.                                 |

**Sampled telemetry is usable but must be declared.** An undeclared sampling rate produces a baseline wrong by exactly that factor and is a leading cause of reconciliation failure.

---

## 5. On sample size

**No fixed sample size is assumed anywhere in this package.**

The number of recorded inputs needed for a replay is derived per call site from measured properties of that call site, not chosen in advance. The determination method is specified in [`experiment-protocol.md`](experiment-protocol.md) §5. What telemetry must supply is the raw material for that determination:

- the **full token distributions**, not summary means — variance drives everything;
- the **rate of rare events** (errors, truncations, unusually long outputs), because rare-but-expensive tails dominate cost variance;
- enough history to estimate whether the distribution is stable or drifting.

A telemetry export that provides only daily averages is **not sufficient**. It cannot support an interval, and any interval computed from it would be fabricated.

---

## 6. Platform mappings

**[INFERENCE] — every mapping below is a starting hypothesis.** Confirm against the customer's actual export before relying on it. Where a field is not found under the expected name, search rather than assume absence.

### OpenTelemetry GenAI semantic conventions

The conventions have been revised repeatedly; check the customer's instrumentation version and the current specification rather than trusting these names.

| Our field        | Likely OTel attribute                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`       | `gen_ai.system` (older) or `gen_ai.provider.name` (newer) — **check both**                                                                                           |
| `model`          | `gen_ai.request.model`; prefer `gen_ai.response.model` when present, since it reports what actually served                                                           |
| `input_tokens`   | `gen_ai.usage.input_tokens` (older instrumentations may emit `prompt_tokens`)                                                                                        |
| `output_tokens`  | `gen_ai.usage.output_tokens` (older: `completion_tokens`)                                                                                                            |
| `call_site_id`   | Span name plus `code.filepath` / `code.function`                                                                                                                     |
| `request_id`     | Span ID; trace ID groups a retry chain                                                                                                                               |
| `latency_ms`     | Span duration                                                                                                                                                        |
| `status`         | Span status plus `error.type`                                                                                                                                        |
| `release_id`     | `service.version` resource attribute                                                                                                                                 |
| `environment`    | `deployment.environment.name` resource attribute                                                                                                                     |
| Cache, reasoning | **Often absent from the conventions.** Usually requires provider-specific attributes or raw response capture. Check explicitly — this is the most likely silent gap. |

### Langfuse

| Our field                   | Likely Langfuse source                                                        |
| --------------------------- | ----------------------------------------------------------------------------- |
| `call_site_id`              | Generation `name`, or a trace tag / metadata key                              |
| `provider`, `model`         | Generation `model` and metadata                                               |
| Token counts                | `usage` object; **confirm whether reasoning and cache tokens are broken out** |
| `request_id`                | Observation ID; trace ID for the chain                                        |
| `latency_ms`                | Derived from start/end times                                                  |
| `cost_usd`                  | `calculatedTotalCost` — cross-check only, never authoritative (see §7)        |
| `environment`, `release_id` | Trace metadata, tags, or the `release` field                                  |
| Quality signals             | `scores` attached to traces or observations — **establish their provenance**  |

Export path: API, or a self-hosted database query. Self-hosted Langfuse usually removes the largest privacy objection and should be asked about early.

### Helicone

| Our field      | Likely Helicone source                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `call_site_id` | Custom properties (`Helicone-Property-*`) — **usually the only viable key**                                                                                |
| Token counts   | Request/response log                                                                                                                                       |
| `request_id`   | Helicone request ID                                                                                                                                        |
| Cache          | Helicone's own cache flags — **distinguish Helicone's proxy cache from provider-side prompt caching. They are different things with different economics.** |
| `retry_count`  | Retry metadata if retries are configured in Helicone                                                                                                       |
| `cost_usd`     | Computed cost — cross-check only                                                                                                                           |

**[INFERENCE]** As a proxy, Helicone sees only what passes through it. Direct SDK calls bypassing the proxy are invisible and are a frequent cause of an understated baseline.

### Gateways — Portkey, LiteLLM, OpenRouter, Cloudflare AI Gateway, Bifrost

| Our field           | Likely gateway source                                                                |
| ------------------- | ------------------------------------------------------------------------------------ |
| `call_site_id`      | Request metadata, virtual key, or custom header                                      |
| `provider`, `model` | Resolved routing decision — **capture what actually served, not what was requested** |
| Token counts        | Gateway logs                                                                         |
| `retry_count`       | Gateway-level retries and fallbacks                                                  |
| Cache               | Gateway semantic or exact cache                                                      |
| `cost_usd`          | Gateway-computed — **may include a markup. See §7.**                                 |

**Routing is a first-class complication.** When a router selects among models per request, the "current configuration" is a distribution rather than a single model, and a PR that changes routing rules changes that distribution. This must be modelled explicitly, not collapsed to a modal model.

### Raw provider logs

| Provider      | Notes                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI        | Usage API and dashboard exports give aggregates; per-call detail generally requires application-side logging.                           |
| Anthropic     | Usage reporting plus application-side logging; cache read/write and reasoning tokens must be captured from the response `usage` object. |
| AWS Bedrock   | CloudWatch metrics and invocation logging (S3). Cost via Cost Explorer, which lags and aggregates.                                      |
| Azure OpenAI  | Azure Monitor diagnostic logs plus Cost Management.                                                                                     |
| Google Vertex | Cloud Logging plus Cloud Billing export to BigQuery.                                                                                    |

**[INFERENCE]** Raw provider logs are usually the **worst** source for this method, because call-site identity is absent — the provider does not know which line of code called it. Application-side telemetry is strongly preferred; provider logs are best used as the reconciliation reference, not the profile source.

### Application logs only

Workable if per-call structured records carry token counts. Requires a custom parser and adds a day. Confirm that failed and retried calls are logged, not just successes — this is usually where such logs fall short.

---

## 7. Known telemetry traps

Each of these has produced a wrong baseline in a way that looks correct. Check every one explicitly.

| Trap                                     | Effect                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Retries counted as distinct calls**    | Inflates volume and cost. A logical request with 3 attempts is one user-facing call.                                                                   |
| **Retries not counted at all**           | Understates cost. Billed attempts vanish from the profile.                                                                                             |
| **Non-production traffic included**      | Staging, CI, and load tests inflate the baseline. Filter on `environment`, and verify the filter worked.                                               |
| **Platform-computed cost trusted**       | Platform price tables lag, miss cache tiers, miss reasoning tokens, and may embed a gateway markup. **Always recompute; use theirs as a cross-check.** |
| **Cache tokens missing**                 | Overstates cost substantially where prompt caching is in use.                                                                                          |
| **Reasoning tokens missing**             | Understates cost substantially on reasoning models.                                                                                                    |
| **Proxy bypass**                         | Direct SDK calls skip the proxy and are invisible.                                                                                                     |
| **Undeclared sampling**                  | Baseline wrong by exactly the sampling factor.                                                                                                         |
| **Streaming token accounting**           | Some instrumentations under-report tokens on streamed responses.                                                                                       |
| **Batch API calls**                      | Priced differently, often at a discount; must be segregated.                                                                                           |
| **Multiple providers for one call site** | Fallback chains mean one call site spans several price tables.                                                                                         |
| **Clock skew / timezone**                | Misaligns the profile window against the billing period.                                                                                               |
| **Model aliases**                        | `gpt-4o` resolving to different snapshots over the window changes the price mid-profile.                                                               |

---

## 8. PII-safe modes

Ranked by preference. **Mode A is the default and the design target**, not a fallback offered under objection.

### Mode A — in-CI / self-hosted replay _(default)_

- Metadata-only telemetry is shared with us; it contains no request or response content.
- We supply a self-contained script and a written specification.
- The customer runs it inside their own CI or infrastructure, against their own inputs, with their own keys.
- Only **aggregate numbers** are returned: distributions, deltas, scores, counts.
- The customer inspects the output before sending it.
- **We never hold request or response content.**

### Mode B — de-identified sample shared with us

- Customer redacts or synthesizes identifiers before export.
- Maximum 30-day retention, then deletion with written confirmation.
- Isolated storage, never commingled, never used for training, benchmarking, or another customer's work.
- Deletion on request within 2 business days, at any time.

### Mode C — metadata-only, no replay

- No content is available at all.
- Token-distribution modelling replaces replay.
- **Cost deltas carry materially wider intervals, and quality deltas cannot be measured at all** — the report must say "insufficient evidence" for quality rather than estimate it.
- Recorded as a partial result. Still informative for the sprint: it tests whether a cost-only report has value.

### Mode D — synthetic proxy inputs

- Inputs generated to match measured statistical properties (length distribution, structure) without real content.
- **Weakest mode.** Real-input distribution effects are lost, and quality evaluation is close to meaningless.
- Use only when A–C are all blocked, and label the entire report as directional.

**[INFERENCE]** Which mode a customer accepts is itself a finding. Record it for every engagement. If most teams require Mode A, that is a strong architectural signal for whatever gets built. If most refuse even Mode A, kill criterion 2 is triggered.

---

## 9. Retention and deletion

| Data                                   | Retention                                   | Deletion                                  |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| Metadata telemetry export              | Duration of engagement + 30 days            | Deleted on request within 2 business days |
| Request/response content (Mode B only) | **30 days maximum**                         | Deleted with written confirmation         |
| Aggregate results and reports          | Retained; contains no customer content      | Deleted on request                        |
| Invoice figures                        | Duration of engagement + 30 days            | Deleted on request                        |
| Interview notes                        | Retained, anonymized for aggregate findings | Company name removed on request           |

**Commitments:** no customer data is used for training any model; no data is shared with any third party; no data is commingled between customers; no data is retained after a deletion request beyond the stated window.

---

## 10. Pre-engagement checklist

Run against the actual export, not against the customer's description of it. **[INFERENCE]** Descriptions of telemetry are optimistic with remarkable consistency.

- [ ] All eight required fields present in a real sample of records.
- [ ] Call-site identity resolvable, and by which method (§2).
- [ ] Cache token fields present, or confirmed absent and its impact estimated.
- [ ] Reasoning token fields present, or confirmed not applicable to the models in use.
- [ ] Failed and retried calls present and distinguishable.
- [ ] `environment` present, or non-production traffic separable another way.
- [ ] Release or commit identity available for post-deployment scoring (§3).
- [ ] Sampling rate known and declared.
- [ ] Window covers ≥ 14 days and one complete billing period.
- [ ] Every provider in use is represented — no proxy bypass.
- [ ] Token _distributions_ available, not only aggregates (§5).
- [ ] At least one quality signal identified, and its type recorded.
- [ ] Privacy mode agreed (§8) and the security stakeholder has confirmed it.
- [ ] Retention and deletion terms accepted (§9).

Any unchecked required item is recorded in [`validation-scorecard.md`](validation-scorecard.md) as a blocker, with the specific field named. Blockers are evidence, not obstacles to be worked around.
