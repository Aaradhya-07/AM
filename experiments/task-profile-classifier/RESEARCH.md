# Why this experiment exists

Anvilmark records a coding task's `kind`, language set, risk, architecture part,
agent, model, and reviewed outcome. The first useful local classifier would
suggest the task kind and abstain when it lacks evidence. A later router might
choose a coding model, but that requires paired model outcomes on comparable
tasks; a task-type label alone does not tell us which model will finish a task.

## Primary sources reviewed (2026-10-19)

- [NLBSE'23 issue-classification competition](https://github.com/nlbse2023/issue-report-classification)
  supplies 1,418,201 GitHub issue reports in four classes. The publisher reports
  0.851 micro-F1 for FastText and 0.891 for a RoBERTa baseline on its full
  official test. We use the public archive as a **proxy** for coding-task
  understanding, with a smaller training sample and full official test.
  Its labels are project-assigned, so they are weaker than independent human
  review. Only `bug` and `feature` map directly to Anvilmark's kind schema.
- The [competition report](https://ojcchar.github.io/files/24-nlbse23-tools.pdf)
  documents label inconsistency across projects and frequent confusion between
  bug reports and questions. Its RoBERTa baseline used a 3060 with 12 GB peak
  memory and 17.5 hours of training. A compact model is appropriate for this
  machine's 6 GB 4050; equal quality is an experiment, not an assumption.
- [RouteLLM](https://arxiv.org/abs/2406.18665) learns a strong-versus-weak
  model decision from preference data. Its published routing gains are on its
  own task distribution and do not imply savings in Anvilmark coding runs.
- [CoDyn](https://openreview.net/pdf?id=0ox03jE6jb) studies routing specifically
  for coding-related tasks and reports average cost savings in its setup.
  Its reported figures are not a substitute for our own matched coding-agent
  runs, with retries and human acceptance included.
- [Task-to-Model Optimization](https://arxiv.org/abs/2608.08528) uses cost per
  completed coding task, including escalation and developer wait, rather than
  cost per token. Its proposed path progresses from task taxonomy and matched
  benchmarks through a shadow classifier to verified routing. This fits
  Anvilmark's evidence-first design.
- An independent [pre-registered coding-task routing
  study](https://akaiserauer.com/research/model-routing) found a fixed
  mid-tier model cheaper than its router on one 65-task workload. This is a
  useful reminder to beat the best fixed-model baseline, not merely an
  expensive always-strong baseline.
- [OpenAI's 2026 SWE-bench Verified audit](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)
  documents flawed tests and contamination in an agentic coding benchmark.
  Issue-type classification is a separate target, but the same lesson applies
  to future routing evaluation: use fresh repository tasks and human-reviewed
  outcomes, and audit what was available to the models.

## Practical research sequence

1. Measure title/body task-type prediction against a strong simple baseline
   and a compact GPU model, with held-out issue reports and abstention.
2. Collect independently reviewed Anvilmark tasks across **all six** kind
   labels. A public four-class score cannot validate the product taxonomy.
3. Add context features that exist **before dispatch**: language, architecture
   part, task text, size indicators, acceptance checks, and hard restrictions.
   Keep declared risk and model restrictions as explicit rules.
4. Run cheap and strong coding-agent candidates on matched, frozen repository
   states. Record acceptance, retries, tokens, wall time, and actual billed
   cost. Compare fixed cheap, fixed strong, and a verifiable cascade before
   fitting a learned router.
5. Train a router only if those paired outcomes show a useful decision boundary.
   Optimize completion cost with a quality floor, validate thresholds on a
   representative holdout, and start in advisory or shadow mode.

The public competition repository is AGPL-3.0; its dataset reuse rights are
not separately stated in the material reviewed. This experiment keeps archives
and trained weights ignored and local. Distribution or production use of a
model trained on these issues needs a separate licensing review.
