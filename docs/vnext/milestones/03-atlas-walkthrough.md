# Milestone 3 — Atlas walkthrough

Status: **Milestone 3 passed independent review at `b7f61e8` and was merged locally into `main` on September 14, 2026.**

This walkthrough takes the ratified Atlas Support Desk draft through the whole
Milestone 3 flow: import, explicit unknowns, a structured intelligence proposal,
honest comparison of alternatives, proposal protection, a proposed decision,
and interactive approval. It uses the offline, reproducible path: a pre-authored
proposal ([`../fixtures/atlas-intelligence-proposal.json`](../fixtures/atlas-intelligence-proposal.json))
stands in for your agent's response. No model, credential or network access is
needed.

Sections 0–8 were run exactly as written, in an isolated directory, before this
document was committed — including the edited import in section 6 and the two
refused approvals in section 8 — except the interactive `anvilmark approve` in
section 8, which is yours to run. Section 9 follows a real approval, so it was
not run here; the behaviour it describes is covered by the automated test
"makes the approval non-current when resolved content changes" in
`packages/cli/test/decisions.test.ts`, which simulates the interactive input.
Section 10 needs a local model server and was not run.

## 0. Build and set up an isolated project

Run from the ANVILMARK repository root, in bash or zsh:

```bash
pnpm install
pnpm build
export REPO="$PWD"
anvilmark() { node "$REPO/packages/cli/dist/bin.js" "$@"; }
export ANVILMARK_CONFIG_HOME="$(mktemp -d)"
export WORK="$(mktemp -d)/atlas"
mkdir -p "$WORK" && cd "$WORK"
```

`ANVILMARK_CONFIG_HOME` points at an empty host configuration, so no provider
is registered and nothing remote can run.

## 1. Import the reviewed Atlas contract

```bash
anvilmark init --from-contract "$REPO/docs/vnext/fixtures/atlas-project.draft.yaml" --intelligence handoff
anvilmark status
```

The contract is validated in full and saved as state revision `r1`. Atlas
already holds five separate workloads, hard/soft constraints, a declared RTX 4090
target, a budget, two unevaluated classification candidates and one unresolved
question. `status` lists what is still not provided (decisions).

## 2. Keep an unknown explicit

```bash
anvilmark workload burst --workload classification --peak-calls-per-minute 120 --note "Assumed Monday-morning peak; not measured"
anvilmark intent add-question "What burst load must PII redaction absorb?"
anvilmark workload add --id escalation_summary --name "Escalation summaries for managers" \
  --input redacted_customer_ticket --output plain_text --output-classification escalation_summary_text
anvilmark status
```

A known burst assumption becomes an informational throughput constraint; an
unknown one stays a question. The new workload's monthly volume is not known,
so it is recorded as unknown (`calls_per_month: null`, `basis: unknown`) rather
than guessed, and its output classification is declared. `status` lists
`escalation_summary` under "monthly usage unknown", and the five Atlas workloads
under "output classification not declared", because Atlas declares none and
none is inferred. Nothing is guessed.

## 3. Look at exactly what an agent would receive

```bash
anvilmark intelligence list
anvilmark propose preview --task propose_candidates
```

The preview shows the mechanism, that ANVILMARK itself sends nothing, the data
categories included and withheld, that repository contents and evaluation rows
are not included, and the exact request. Nothing is written.

## 4. Export a request, answer it, import it

```bash
anvilmark propose export --task propose_candidates
export REQ="$(ls .anvilmark/intelligence/requests | sed 's/\.json$//')"
echo "$REQ"
```

With a real agent you would now tell Claude Code or Codex: _"Read
`.anvilmark/intelligence/handoff/<REQ>.request.json` and follow `how_to_respond`
exactly."_ For the reproducible path, use the pre-authored response:

```bash
cp "$REPO/docs/vnext/fixtures/atlas-intelligence-proposal.json" ".anvilmark/intelligence/handoff/$REQ.response.json"
anvilmark propose import "$REQ"
anvilmark history
```

The proposal adds two meaningfully different alternatives for response
drafting — `candidate.response_drafting.local_first` and
`candidate.response_drafting.hybrid_managed` — both `discovered`, one
informational constraint recorded as `agent_proposed`, two questions, and one
inference stored as T0 `agent_inference` evidence. The history entry records the
proposal id, request digest, mechanism and generated rationale.

## 5. Compare the alternatives honestly

```bash
anvilmark compare --workload response_drafting
anvilmark compare --workload classification --probe-tools
anvilmark compare --workload escalation_summary
```

For each candidate: satisfied, failed and unknown constraints, evidence on
record with tier and freshness (the inference shows as T0 and cited for
nothing), assumptions, incompatibility reasons, and the evidence still required
— pricing, provider region, the citation-validity evaluation. There is no
overall score. `--probe-tools` reports llmfit and promptfoo as `unavailable`
gaps if they are not installed; the command still succeeds. The escalation
summary shows "monthly usage unknown" and a `missing_usage` gap.

```bash
anvilmark candidate status candidate.response_drafting.hybrid_managed viable
```

This is refused: nothing establishes viability yet.

## 6. See a proposal refused as a whole

```bash
anvilmark propose export --task propose_constraints
export REQ2="$(ls -t .anvilmark/intelligence/requests | head -n 1 | sed 's/\.json$//')"
cat > ".anvilmark/intelligence/handoff/$REQ2.response.json" <<'JSON'
{
  "protocol_version": "0.1.0-draft.1",
  "proposed_constraints": [
    {
      "id": "quality.classification_f1",
      "domain": "quality",
      "severity": "soft",
      "direction": "maximize",
      "subject": "workload.classification.metric.macro_f1",
      "operator": "gte",
      "value": 0.5,
      "source": "agent_proposed",
      "rationale": "Relax the gate"
    }
  ],
  "proposed_candidates": [
    {
      "id": "candidate.classification.fast",
      "workload_ref": "classification",
      "component_kind": "model_runtime",
      "model_family": null,
      "model_version": null,
      "deployment_mode": "managed_api",
      "provider": null,
      "rationale": null,
      "status": "viable"
    }
  ]
}
JSON
anvilmark propose import "$REQ2"
anvilmark validate
```

The import exits `1`: a response may not set a candidate status. Remove the
`"status"` line (and the comma that ends the line before it) and import again,
and it is still refused, because it redefines the hard constraint
`quality.classification_f1`. The contract is unchanged, and
the refusal is recorded under `.anvilmark/intelligence/proposals/`.

## 7. Draft and propose a decision

```bash
anvilmark candidate deploy candidate.classification.local_unselected --runtime ollama
anvilmark decision draft --id decision.classification --workload classification \
  --select candidate.classification.local_unselected \
  --alternative candidate.classification.remote_unselected \
  --rationale "Keep classification local first; revisit after evaluation."
anvilmark decision propose decision.classification
```

`decision propose` is refused: four hard constraints are unknown for the
selected candidate and the decision does not say so. Declare them, then propose:

```bash
anvilmark decision revise decision.classification \
  --unresolved privacy.raw_ticket_remote,availability.classification_provider,quality.classification_f1,quality.schema_validity
anvilmark decision propose decision.classification
anvilmark review decision.classification
```

`review` shows the selected candidate, the alternative, every constraint
standing, cited evidence, the open questions, that the rationale was written by
the user, and the approval hash.

## 8. Approve interactively (you run this)

```bash
anvilmark approve decision.classification
```

It prints the review again, asks who is approving, and asks you to type the
first 12 characters of the approval hash. Pressing Enter, typing anything else
or ending input approves nothing (exit `3`). Piped input is refused outright
because stdin is not a terminal:

```bash
echo yes | anvilmark approve decision.classification
anvilmark approve decision.classification --yes
```

Both exit without approving.

## 9. Watch an approval stop being current

After approving in step 8:

```bash
anvilmark approval status
anvilmark candidate assume candidate.classification.local_unselected "Runs on the declared RTX 4090 only"
anvilmark approval status
anvilmark history
```

The assumption changes the selected candidate, so the decision returns to
`proposed` as revision 3, the contract revision advances, and the earlier
approval stays in the history as not current. Approve again to cover the new
content; both approval records remain.

## 10. Optional: a local runtime

With [Ollama](https://ollama.com) or another OpenAI-compatible server running
locally, register it in your host configuration (outside the project) and send
the same request. This path was tested against a controlled local server; no
live runtime was used while writing this walkthrough.

```bash
cat > "$ANVILMARK_CONFIG_HOME/host.json" <<'JSON'
{
  "format": "anvilmark-host/0.1",
  "intelligence_providers": [
    {
      "id": "ollama-local",
      "mechanism": "openai_compatible",
      "base_url": "http://127.0.0.1:11434/v1",
      "model": "YOUR_LOCAL_MODEL",
      "reach": "local",
      "cost": "no_provider_charge",
      "json_response_format": true
    }
  ]
}
JSON
anvilmark intelligence list
anvilmark propose send --via ollama-local --task explain_tradeoffs
```

A small local model may well return something the protocol rejects; the
project is then unchanged and the rejection is recorded.

## Clean up

```bash
cd "$REPO"
rm -rf "$WORK" "$ANVILMARK_CONFIG_HOME"
```
