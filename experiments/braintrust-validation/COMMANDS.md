# Exact Commands, Expected Outputs, and Stop Conditions

Phases map to [`../../docs/validation/braintrust-hands-on-test-plan.md`](../../docs/validation/braintrust-hands-on-test-plan.md) §5.

**Everything in Phase 0 is runnable now. Everything from Phase A onward is blocked on credentials.**

---

## Phase 0 — offline preparation _(no credentials, runnable now)_

### 0.1 Generate datasets

```bash
node experiments/braintrust-validation/generate-datasets.mjs
```

**Expected output:** three files written to `experiments/braintrust-validation/data/`, followed by a class distribution with `order_status` at roughly 61% and `other` at roughly 1%, and Scenario 2 body lengths with p50 near 2,600 characters and max near 10,800.

**Stop if:** the distribution is not skewed. A flat distribution defeats test T4, which exists to check whether Braintrust can weight by production frequency.

### 0.2 Confirm determinism

```bash
cd experiments/braintrust-validation && shasum data/*.jsonl && node generate-datasets.mjs >/dev/null && shasum data/*.jsonl
```

**Expected:** identical checksums before and after. `s1-tickets.jsonl` and `s1-repeat.jsonl` must also match each other — they are the noise-floor control pair.

**Stop if:** checksums differ between runs. A non-deterministic dataset makes the old-vs-old control meaningless.

---

## Phase A — logs to dataset _(blocked: needs credentials)_

Run in the **throwaway repository**, not here.

```bash
npm i braintrust openai
cp .env.example .env   # then fill in .env locally; never commit it
export SCENARIO_ARM=old RUN_TAG=prod-sim
npx tsx eval-scenario-1.ts
```

**Expected:** an experiment appears in the Braintrust UI; logs show per-span token counts and cost.

**Capture:** screenshot of the log view showing cost and tokens per span. Then attempt logs → dataset conversion in the UI and screenshot the result.

**Answer:** does the resulting dataset preserve `frequency_weight`, or is it a flat list of rows?

**Stop if:** logs do not show per-span cost. That contradicts the documentation and must be resolved before any other conclusion is drawn.

---

## Phase B — experiment comparison _(blocked)_ — **the decisive phase**

```bash
export SCENARIO_ARM=old RUN_TAG=run1 && npx tsx eval-scenario-1.ts
export SCENARIO_ARM=new RUN_TAG=run1 && npx tsx eval-scenario-1.ts
```

Then open the comparison view in the Braintrust UI.

**Capture:** a screenshot of the **full comparison view with every column visible**. This single screenshot decides test T1.

**Answer, explicitly:**

1. Does cost or token usage appear anywhere in the comparison? **(T1)**
2. Is comparison row-paired per input, or aggregate-only?
3. Can results be weighted by the `frequency_weight` metadata field? **(T4)**
4. Is any figure projected to a time period or multiplied by volume? **(T3)**

**Stop and escalate if:** cost deltas appear as a first-class metric **and** any volume projection exists. That is T1 and T3 both failing — the wedge is occupied and the sprint pauses before Day 5 telemetry requests.

---

## Phase C — the PR surface _(blocked)_

```bash
cp experiments/braintrust-validation/github-workflow.yml \
   <throwaway-repo>/.github/workflows/braintrust-eval.yml
```

Then, in the throwaway repo: commit, open a PR changing `S1_NEW_MODEL` to the cheaper model, and wait for the action.

**Capture:** screenshot of the PR comment, for both scenarios.

**Answer:** does any cost field appear? Compare against the documented fields — Score, Average, Improvements, Regressions, Duration.

**Stop and escalate if:** a cost or token delta appears in the PR comment. **T2 failing alone is sufficient to pause the sprint** — C5 was the primary commercial hook.

---

## Phase D — noise floor _(blocked)_ — cheapest and most diagnostic

```bash
export SCENARIO_ARM=old RUN_TAG=controlA && npx tsx eval-scenario-1.ts
export S1_DATASET=data/s1-repeat.jsonl
export SCENARIO_ARM=old RUN_TAG=controlB && npx tsx eval-scenario-1.ts
```

Compare `controlA` against `controlB` — **the same configuration on byte-identical data.**

**Capture:** screenshot of the old-vs-old comparison.

**Answer:** does Braintrust present run-to-run variation as "improvements and regressions"? Is there any statistical treatment, or any indication that a difference may be noise? **(T7)**

Repeat with Scenario 2, where variance is much higher.

**[INFERENCE]** If comparing a configuration against itself yields a confident list of improvements and regressions with no noise treatment, that is a specific, demonstrable methodological gap — and it is the clearest available argument for calibration.

---

## Phase E — cost surfaces _(blocked)_

No commands. UI inspection only.

**Answer:**

1. Is there any feature comparing platform-computed cost against an actual provider invoice? **(T6)**
2. Is any cost figure forward-looking, or is everything retrospective? **(T3)**
3. Is there any comparison of an experiment result against subsequent production behaviour? **(T5)**

**Stop and escalate if:** any predicted-versus-actual feature exists. **T5 failing means C8 is occupied — the defensibility argument — and the wedge should be reassessed immediately.**

---

## Global stop conditions

Halt the phase, record the evidence, and escalate before spending introduction capital, if any of these occur:

| Condition                               | Test | Consequence                                              |
| --------------------------------------- | :--: | -------------------------------------------------------- |
| Cost delta appears in the PR comment    |  T2  | Pause sprint; C5 occupied                                |
| Any monthly/volume projection exists    |  T3  | Pause sprint; C5 occupied                                |
| Predicted-vs-actual feature exists      |  T5  | Pause sprint; C8 occupied — the defensibility case       |
| Provider spend exceeds the cap          |  —   | Stop, record actual spend as a finding                   |
| Action inputs differ from this template |  —   | Verify against the action's current README; do not guess |

## Never do

- Commit `.env`, any API key, or any credential.
- Run any phase against a production API key.
- Run Phase D without a spend cap.
- Copy this workflow into **this** repository's `.github/workflows/`.
- Report a conclusion without the corresponding screenshot. A written assertion does not update the matrix.
