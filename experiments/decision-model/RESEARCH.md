# Open decision-model research track

Started 2026-10-17. The goal is an **open, locally runnable classifier** that
accepts a state and a caller-defined question, then returns a valid answer and
useful uncertainty. Jev is a comparison target, not a training dependency or
the architecture to copy. The initial product context is Anvilmark's coding
task profile; a claim of general Jev parity would require a much broader test.

## What is public

TypeSafe [documents](https://docs.typesafe.ai/introduction) Choice, Score, and
Noul questions, typed outputs, probabilities, and its API. Its
[launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
names a new architecture, parallel sampler, and Reinforcement Learning for
Calibrated Decisions. It does not provide a reproducible architecture, training
recipe, weights, or training data. We cannot infer those details from marketing
or treat an independent implementation as a Jev reproduction.

## Research starting points

| Paper                                                                                                                            | Finding to test here                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Yin, Hay & Roth, 2019](https://arxiv.org/abs/1909.00161)                                                                        | Formulate unseen label sets as entailment; evaluate fully unseen labels across different aspects, not only topics.                                                                                                                                                                   |
| [Larson et al., 2019, CLINC150](https://aclanthology.org/D19-1131/)                                                              | Evaluate many dynamic intent labels and out-of-scope rejection on a separate corpus. Its original dataset repository provides 150 intent classes and an out-of-scope split.                                                                                                           |
| [Stepanov et al., 2025, GLiClass](https://arxiv.org/abs/2508.07662)                                                              | Score dynamic labels efficiently in one forward path. Its [edge checkpoint](https://huggingface.co/knowledgator/gliclass-edge-v3.0) is an Apache-2.0 open-weight candidate for a first CPU run. Its published speed figures use an A6000 GPU and are not estimates for this machine. |
| [Tunstall et al., 2022, SetFit](https://arxiv.org/abs/2209.11055)                                                                | Use a small number of reviewed labels to adapt an encoder; compare with zero-shot behavior and test for loss on unseen classes.                                                                                                                                                      |
| [FastFit, 2024](https://arxiv.org/abs/2404.12365)                                                                                  | Compare batch contrastive training and token-level similarity with our current single-query embedding loss.                                                                                                                                                                         |
| [Reimers & Gurevych, 2019, Sentence-BERT](https://aclanthology.org/D19-1410/)                                                     | A two-encoder retrieval stage is efficient for many labels; a cross-encoder reads a text pair jointly at higher cost. Our shortlist-plus-pair-reranker experiment uses this established tradeoff, not a novel architecture.                                                         |
| [Guo et al., 2017](https://proceedings.mlr.press/v70/guo17a.html)                                                                | Fit temperature scaling on a held-out calibration split; measure whether probabilities improve without changing the ranking.                                                                                                                                                         |
| [Geifman & El-Yaniv, 2017](https://papers.neurips.cc/paper_files/paper/2017/hash/4a8423d5e91fda00bb7e46540e2b0cf1-Abstract.html) | Evaluate a reject option: how error falls as uncertain cases go to a person or stronger model.                                                                                                                                                                                       |
| [Angelopoulos & Bates, 2021](https://arxiv.org/abs/2107.07511)                                                                   | Study conformal prediction sets for uncertainty, checking exchangeability assumptions before claiming coverage.                                                                                                                                                                      |

## Proposed model path

1. **Define the contract.** Start with text and structured text state, Choice
   over caller-supplied label descriptions, Noul (binary probability), and
   Score (ordered levels). Enforce output membership and schema in code.
2. **Establish baselines.** Evaluate a simple lexical classifier, an NLI model,
   and a pinned GLiClass checkpoint on identical questions and labels. Record
   exact model revision, hardware, preprocessing, and evaluation code revision.
3. **Train our candidate.** Adapt an open encoder on diverse labeled and
   synthetic state/question/label triples. Keep entire label sets and domains
   out of training for a true zero-shot test. Compare a dynamic label encoder
   with a cross-encoder teacher; train with a proper probabilistic loss.
4. **Calibrate and route.** Fit calibration on a separate split and measure
   Brier score, log loss, and reliability by domain and label count. Test an
   abstain or escalate path. A potential innovation is a small, fast first pass
   with a second pass only when its calibrated risk estimate says the extra
   compute is useful. This remains a hypothesis until measured.
5. **Measure against Jev.** Run both systems on the same held-out tasks and
   option descriptions. Compare quality, calibration, p50/p95 latency, memory,
   throughput, and cost per accepted decision. Separate local hardware cost
   from API list price. Report failures and changed model versions.

## Evaluation rules before any parity claim

- Use independently reviewed examples from several domains, with a frozen
  train, calibration, validation, and test split. The six bundled Anvilmark
  examples are only an illustrative smoke set.
- Include novel label sets, short and long inputs, ambiguous cases, and shifts
  in domain. Measure each question type separately.
- Report macro-F1 and accuracy for Choice, Brier score and log loss for
  probabilities, risk versus coverage for abstention, and end-to-end latency
  including preprocessing. Include sample size and uncertainty intervals.
- Predeclare the task-specific tolerance for "on par" before looking at the
  held-out result. A win on task profiling alone is not general parity with
  Jev, and Jev's published benchmark is not independent evidence for ours.
- Keep third-party checkpoints and datasets under their own licenses, and log
  data provenance. Never train on held-out Jev answers.

## Current environment and next gate

This workspace has a 12-thread CPU and 15 GiB RAM. Its RTX 4050 has 6 GiB
VRAM. After installing the matching NVIDIA driver module and rebooting, the
GPU works with PyTorch `2.14.1+cu130` outside the restricted workspace
sandbox. The frozen MiniLM encoder plus learned projection did not beat the
untouched encoder on held-out BANKING77 labels or the MASSIVE domain check.
The next candidate fine-tuned the full MiniLM query encoder on the 4050. It
improved an exploratory BANKING77 test but did not beat the untouched encoder
on raw MASSIVE inputs. A larger BANKING77+MASSIVE GPU run improved robustness
to explicit questions on held-out CLINC150, while raw-input accuracy stayed
essentially flat (see [EVIDENCE.md](EVIDENCE.md)). Several RTX 3060 machines
may be available later. Their VRAM will not pool automatically, so a
distributed training run needs a measured reason and dedicated orchestration.
A foundation model trained from scratch is outside this machine's capacity.

The next label-aware pair reranker improved a new original-source HWU intent
test by 12.4 points over frozen retrieval after excluding 375 exact MASSIVE
training overlaps. A separate GoEmotions check showed a smaller binary
sentiment gain and no meaningful improvement on 28-way emotion choice. On an
independent ordered well-formedness score task, it was worse than a constant
midpoint. The result directs the next research stage toward genuinely different
training questions and calibrated uncertainty. The
current checkpoint has fast warm single-request inference on the 4050, but
there is no quality or speed comparison with Jev yet.

The sibling [Jev task-profile experiment](../jev-task-profile/README.md) is
the API comparison harness. Its report contains predictions, timing, tokens,
and estimated API cost. It has not been run live because no TypeSafe key is
present in this environment.
