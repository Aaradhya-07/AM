# Cost optimization research map for Anvilmark

Checked **24 October 2026**. This is a broad, source-linked inventory of research relevant to the cost of AI-assisted software development and LLM inference. It is **not a claim to include every paper ever written**: that field has no closed catalog, and new preprints appear daily. The search covered primary papers and proceedings on coding-agent economics, model routing, context and caching, verification, local inference, and measurement. It excludes training-efficiency research, price lists, vendor marketing, and surveys when a primary study was available. Papers are grouped by the intervention they test; a few studies fit more than one group and appear only once.

**Reading rule:** All numbers below are the authors' reported results in their stated setting, not savings achieved by Anvilmark. “Measured” means the authors ran an experiment or analyzed traces; it does not imply independent replication. “Method” or “proposal” means no demonstrated end-to-end savings in the setting Anvilmark needs. Most 2026 papers are preprints. API rates, model versions, cache behavior, and benchmark quality change, so these papers are design evidence rather than current price recommendations.

## Findings that change the build order

1. **Optimize accepted work, not tokens.** In a controlled coding-agent comparison, removing 38.4% of tool-output tokens raised billed cost by 6.8%; some minification reduced task resolution. Cache reads, extra turns, retries, and patch quality changed the result. [Token Reduction Is Not Cost Reduction](https://arxiv.org/abs/2607.12161), [State-in-Context Minification](https://arxiv.org/abs/2606.01326).
2. **A router must beat a strong fixed choice.** One independent coding-task experiment found a fixed middle-tier model 23% cheaper than its router at equal completion. A 2026 study found six commercial routers failed to beat a matched-cost random two-model policy in its test. Other papers report routing gains, so the result is workload-dependent. [Independent coding study](https://akaiserauer.com/research/model-routing), [Dynamic LLM Routers are Often Misguided](https://arxiv.org/abs/2610.02762), [HyDRA](https://arxiv.org/abs/2605.17106).
3. **Task setup may be the better first intervention.** Verified repository scouting, complete task specifications, relevant prior context, and selected skills can change both success and cost. In Scrouting's ablation, a simple cheap fixer with the verified handoff tied the routed system. [Scrouting](https://arxiv.org/abs/2608.04804), [task specifications](https://arxiv.org/abs/2608.25399), [SWE Context Bench](https://arxiv.org/abs/2602.08316), [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401).
4. **Count the cost of learning what to optimize.** Paired model runs and human reviews cost money and time. Spend those measurements where they could change a decision. [SaveRouter](https://arxiv.org/abs/2609.37402), [Which LLM for Which Work?](https://arxiv.org/abs/2608.29560).
5. **Measure whole trajectories.** Turn count, prompt caching, tool schemas, repeated retrieval and tests, verification, and developer wait can dominate nominal per-token price. [TurnCost](https://arxiv.org/abs/2610.15093), [coding-agent behavior study](https://arxiv.org/abs/2609.30725), [Task-to-Model Optimization](https://arxiv.org/abs/2608.08528). The last is a methodology, not a measured saving.

## 1. Coding-agent cost and task completion

| Study | Evidence and practical limit |
| --- | --- |
| [TurnCost: Turns, Not Observations](https://arxiv.org/abs/2610.15093) (Oct 2026) | Observational analysis of 600 released trajectories: turn count explained much more cost variation than mean tool-output size under heavy prefix caching. It does not prove that turns can be removed safely. |
| [Coding-Agent Benchmarks Should Match Their Users' Task Flows](https://arxiv.org/abs/2610.09633) (Oct 2026) | 4,782 developer sessions inform a task-flow benchmark; staged interactions roughly doubled cost on 700 SWE-bench Pro tasks without a stable solve-rate change. Benchmark protocol matters. |
| [Cheapest per token is not cheapest per task](https://akaiserauer.com/research/model-routing) (Sep 2026) | Independent preregistered 65-task coding handoff experiment: a fixed middle-tier model beat the router by 23% at equal completion. Narrow model pool, but a vital baseline check. |
| [Analyzing and Mitigating Cost-Inefficient Behaviors in Coding Agents](https://arxiv.org/abs/2609.30725) (Sep/Oct 2026) | Analysis and over 10,000 mitigation trajectories identify repeated retrieval, script generation and testing; developer-designed skills saved up to 41.73%, while structural retrieval sometimes raised cost. Preprint under review. |
| [Scrouting / SuperScout](https://arxiv.org/abs/2608.04804) (Aug 2026) | On 266 SWE-bench Pro tasks, verified scouting plus a cheap fixer approached strongest-model solves at much lower cost. The no-router cheap-fixer handoff tied its routed system. Python benchmark only. |
| [Prompt-Induced Waste in Coding Agents](https://arxiv.org/abs/2608.01347) (Aug/Sep 2026) | Controlled, preregistered coding runs show task-equivalent prompts, reasoning effort and harness policy can change cost without correctness gain. Small deterministic task set; system factors interact. |
| [Can your AI agent be cheaper? Task specifications](https://arxiv.org/abs/2608.25399) (Aug 2026) | Across 2,700 runs in one model family, reducing a full task specification to a bare story raised token spend 29.7%. Cost sensitivity varied by task. |
| [Cost-Effective Repository Exploration](https://arxiv.org/abs/2608.29675) (Aug 2026) | Cheaper repository explorers reduce localization time and tokens while retaining many top-file hits. The measured stage is file localization, not accepted patches. |
| [CodeGrep](https://arxiv.org/abs/2608.05886) (Aug 2026) | Tests repository retrieval with a frozen coding agent on SWE-bench Verified; reports fewer rounds and tokens and a small resolution gain. Its 14B retrieval agent exceeds this project's small-GPU target. |
| [The reach of a verification tool decides its value](https://arxiv.org/abs/2608.28795) (Aug 2026) | Controlled web-build study: a cheap launch probe catches many failures; broad shell access costs more and helps when it reaches the failure mode. Web-app scope. |
| [Token Reduction Is Not Cost Reduction](https://arxiv.org/abs/2607.12161) (Jul/Aug 2026) | Controlled billed coding runs: aggressive tool-output compression removed tokens but raised billed cost and sometimes harmed patches. A direct warning against token-only optimization. |
| [WISERouter](https://arxiv.org/abs/2607.23765) (Jul 2026) | Constrained contextual-bandit routing using sparse feedback, including SWE-bench experiments. Workload-budget research, not a production accepted-task trial. |
| [SWE-Router](https://arxiv.org/abs/2607.00053) (Jun 2026) | Lets a cheap agent explore briefly before a value head decides whether to continue or escalate. Improves routing metrics over prompt-only decisions on studied model pairs; requires paired trajectories and is not a universal dollar saving. |
| [Agent-as-a-Router / ACRouter](https://arxiv.org/abs/2606.22902) (Jun 2026) | Coding-task benchmark of about 10,000 tasks over eight models; uses feedback and memory. Some simpler static policies have better performance per dollar, and an updated fixed model beats it on one out-of-distribution accuracy comparison. |
| [Code Isn't Memory](https://arxiv.org/abs/2606.22417) (Jun 2026) | Structural codebase indexing improves localization and reported cost per solve on studied multi-file repository tasks. Needs a controlled comparison against simple retrieval in Anvilmark. |
| [Bayesian control for coding agents](https://arxiv.org/abs/2606.24453) (Jun 2026) | Cost-sensitive control chooses whether to verify, refine or stop. Its benefits rely on critics whose quality and calibration must be checked. |
| [Reducing Token Usage of State-in-Context Agents using Minification](https://arxiv.org/abs/2606.01326) (May/Jun 2026) | A 42% input-token reduction came with a 12-point resolution loss on its SWE-bench Verified setup. |
| [HyDRA](https://arxiv.org/abs/2605.17106) (May/Jun 2026) | Five-model coding pool; reports 54.1% lower cost at essentially the fixed Sonnet baseline's SWE-bench Verified resolution. Company-authored preprint and configuration-specific result. |
| [Context Pruning via Multi-Rubric Latent Reasoning](https://arxiv.org/abs/2605.15315) (May 2026) | Reports multi-turn coding wins with lower token use; billed-cost and accepted-task validation remain separate questions. |
| [How Do AI Agents Spend Your Money?](https://arxiv.org/abs/2604.22750) (Apr 2026) | Eight-model SWE-bench analysis finds large same-task token variance and weak links between intuitive task difficulty, token count and success. Repeat runs before forecasting. |
| [Triage: Code Quality Signals for Routing](https://arxiv.org/abs/2604.07494) (Apr 2026) | Analytical proposal to use code health in model-tier selection. It designs a SWE-bench Lite evaluation but reports no empirical routing saving. |
| [Local-Splitter](https://arxiv.org/abs/2604.12301) (Apr 2026) | Workload-specific tactics reduce cloud tokens in a custom agent shim; those numbers do not establish cost per accepted task. |
| [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401) (Mar 2026) | Paired tests of 49 skills: most did not improve pass rate; some added large token overhead, while a small specialized subset helped. |
| [SWE Context Bench](https://arxiv.org/abs/2602.08316) (Feb/May 2026) | Relevant retrieved prior experience improves coding resolution and reduces runtime/tokens; unrelated experience can hurt. |
| [EET: Experience-Driven Early Termination](https://arxiv.org/abs/2601.05777) (Jan/Apr 2026; ACL Findings) | Three SWE agents on SWE-bench Verified: reports 19–55% total-cost reduction with at most a small solve-rate loss by stopping unproductive iterations. |
| [On the Impact of AGENTS.md Files](https://arxiv.org/abs/2601.20404) (Jan 2026) | Paired repository-instruction study reports lower median runtime and output tokens at comparable completion; scope is a limited set of repositories and PRs. |
| [More with Less: Turn-Control Strategies](https://arxiv.org/abs/2510.16786) (Oct 2025) | Fixed and conditional agent-turn budgets reduce spend on studied SWE-bench tasks with limited solve-rate loss; thresholds need workload-specific validation. |
| [Agentless](https://arxiv.org/abs/2407.01489) (2024) | Simple localization, repair and validation achieved competitive results at low reported cost on its then-current SWE-bench Lite setup. Historical baseline, not a current model ranking. |

## 2. Routing, cascades and model allocation

These mostly evaluate single-query or non-coding workloads. Their methods are useful; their savings do not transfer automatically to agentic software engineering.

| Study | Evidence and practical limit |
| --- | --- |
| [RIVET: Response-Informed Value Estimation](https://arxiv.org/abs/2610.23239) (Oct 2026) | Multi-turn router trained with post-call response evidence; reports more MINT solves than its strongest multi-turn baseline at 74.7% lower call cost. New preprint; no repository coding evaluation. |
| [Dynamic LLM Routers are Often Misguided](https://arxiv.org/abs/2610.02762) (Oct 2026) | Six commercial routers, 14 settings; none beat matched-cost random selection between two well-chosen models. A strong negative evaluation on its task mix. |
| [Routing Should Pay for Itself / SaveRouter](https://arxiv.org/abs/2609.37402) (Sep 2026) | Counts the up-front cost of routing labels; sparse supervision cuts estimated payback volume on four routing benchmarks. Coding-agent transfer untested. |
| [Which LLM for Which Work?](https://arxiv.org/abs/2608.29560) (Aug 2026) | Active experimentation for uncertain model–workload quality tables; on paid software tasks, better quality evidence mattered more than solving assignment on poor estimates. Preprint. |
| [Task-to-Model Optimization](https://arxiv.org/abs/2608.08528) (Aug 2026) | Coding-assistant method for cost per completed task, failure escalation and staged shadow deployment. **Methodology, not a measured saving.** |
| [LLMRouter: Unified Infrastructure](https://arxiv.org/abs/2608.06867) (Aug 2026) | Multi-scenario routing framework reports learned-router gains over a fixed baseline. Benchmark construction and task mix differ from contrary evaluations below. |
| [LLMRouterBench](https://aclanthology.org/2026.findings-acl.1881/) (2026; ACL Findings) | 400K+ instances, 21 datasets, 33 models; several routers fail to reliably beat a simple baseline, and adding models shows diminishing returns. |
| [When Does Combining Language Models Help? A Co-Failure Ceiling](https://arxiv.org/abs/2606.27288) (Jun 2026) | Across 67 models, shared failure caps the possible gain from routing or voting; more models do not help if they fail together. |
| [MTRouter](https://aclanthology.org/2026.acl-long.2045/) (2026; ACL) | Chooses models per turn using interaction history; reports cost-quality gains on ScienceWorld and HLE. Model switching and caches need separate coding-agent evaluation. |
| [Generalising LLM Routing using Past Performance Retrieval](https://aclanthology.org/2026.eacl-srw.22/) (2026; EACL) | Similar-query nearest-neighbor estimates perform competitively with learned routers on limited histories. A good first Anvilmark baseline. |
| [SLARouter](https://arxiv.org/abs/2606.19376) (Jun 2026) | Online routing with limited, one-sided user feedback and service-level constraints; feedback differs from code-review acceptance. |
| [RouteNLP](https://arxiv.org/abs/2604.23577) (Apr 2026) | Routing and calibrated cascades with a customer-service pilot; domain and evaluator differ from coding tasks. |
| [UCCI: Calibrated Uncertainty for Cascade Routing](https://arxiv.org/abs/2605.18796) (May 2026) | Escalation calibrated on structured extraction queries; token uncertainty may be a poor proxy for patch correctness. |
| [Conformal LLM Routing with Distribution-Free Safety Guarantees](https://aclanthology.org/2026.acl-srw.70/) (2026; ACL) | Calibrated cheap-model gate on answerable benchmark tasks. Guarantees depend on exchangeability and measured correctness. |
| [Conformal Cascade](https://arxiv.org/abs/2607.25018) (Jul 2026) | Escalates when answer sets are uncertain on multiple-choice tests; authors leave open-ended generation to later work. |
| [R2-Router](https://arxiv.org/abs/2602.02823) (Feb 2026; ICML) | Joint model and response-length budget selection reports large gains on its workloads. Tight length caps may harm agent reasoning. |
| [OrcaRouter](https://arxiv.org/abs/2605.30736) (May 2026) | Offline seed plus contextual-bandit updates; benchmark report, not controlled coding deployment. |
| [CoDyn: Dynamic LLM Routing for Coding Tasks](https://openreview.net/pdf?id=0ox03jE6jb) (2025 workshop) | Routes prompt-level coding tasks across models and reports lower cost at strong-model quality. Not long-horizon repository patches. |
| [IPR: Intelligent Prompt Routing](https://aclanthology.org/2025.emnlp-industry.170/) (2025; EMNLP Industry) | Deployed quality-estimator router reports cost reduction at quality parity. Industrial labeled data and customer workload differ from Anvilmark. |
| [Select-then-Route](https://aclanthology.org/2025.emnlp-industry.28/) (2025; EMNLP Industry) | Task shortlist plus cascade performs well on six benchmarks; account for judge and verification costs. |
| [Adaptive LLM Routing under Budget Constraints](https://aclanthology.org/2025.findings-emnlp.1301/) (2025; EMNLP Findings) | Contextual bandit with preference prior and one-sided feedback; relevant after local review data exists. |
| [Learning to Route LLMs from Bandit Feedback](https://arxiv.org/abs/2510.07429) (Oct 2025) | Learns from selected-model outcomes rather than all model outputs; general-prompt benchmarks, no accepted-code evidence. |
| [BEST-Route](https://arxiv.org/abs/2506.22716) (2025; ICML) | Jointly selects model and number of attempts; savings rely on a reliable output verifier. |
| [Universal Model Routing for Efficient LLM Inference](https://arxiv.org/abs/2502.08773) (2025/2026; ICLR) | Probe-prompt representations support new models without full router retraining; probes still cost money and models drift. |
| [Cost-Saving LLM Cascades with Early Abstention](https://arxiv.org/abs/2502.09054) (2025) | Cheap tier can abstain before escalation; mostly structured tasks, but abstention is a useful design principle. |
| [FrugalGPT](https://mlanthology.org/tmlr/2024/chen2024tmlr-frugalgpt/) (2024; TMLR) | Foundational learned model cascade; large reported savings on selected NLP workloads, with quality estimation as the limiting step. |
| [Hybrid LLM](https://proceedings.iclr.cc/paper_files/paper/2024/hash/b47d93c99fa22ac0b377578af0a1f63a-Abstract-Conference.html) (2024; ICLR) | Difficulty-based small/large model gate; reduction in large-model calls is workload-specific. |
| [RouteLLM](https://arxiv.org/abs/2406.18665) (2024/2025; ICLR) | Preference-trained two-model router with benchmark savings. Human preference is not verified repository correctness. |
| [A Unified Approach to Routing and Cascading for LLMs](https://arxiv.org/abs/2410.10347) (2024; revised 2026) | Formal treatment of routing versus cascades; quality estimation determines whether either wins. |
| [RouterBench](https://arxiv.org/abs/2403.12031) (2024) | Public router benchmark of model outcomes; useful reproducibility base but not a coding-agent outcome set. |

## 3. Context, prompts, caching and verification

| Study | Evidence and practical limit |
| --- | --- |
| [An Empirical Cost Attribution of Context-Compression Gateways](https://arxiv.org/abs/2609.22114) (Aug 2026) | Controlled multi-turn coding-agent comparison separates schema, file/tool content, history and recalls. Tool-schema filtering is reliably positive in its setup. |
| [DTOC: Dynamic Tool Output Compression](https://arxiv.org/abs/2609.26121) (Aug 2026) | Reversible compression reduced cost per solved task for some models; effects were mixed or negative for others, and irreversible variants degraded. |
| [Total Cost of Agency](https://arxiv.org/abs/2609.23790) (Sep 2026) | Attributes injected memory cost in a 200-task enterprise harness; no prompt-cache evaluation. |
| [Cache-Aware Prompt Compression](https://arxiv.org/abs/2607.15516) (Jul 2026) | Compression can break a reusable cached prefix and raise final spend; combined cache-aware design wins in studied configurations. Provider/version dependence. |
| [Don't Break the Cache](https://arxiv.org/abs/2601.06007) (Jan 2026) | Over 500 research-agent sessions across three providers show large API-cost gains from caching; moving dynamic content changes outcomes, and full-context caching can hurt latency. Not coding agents. |
| [Prompt Compression in the Wild](https://arxiv.org/abs/2604.02985) (Apr 2026) | End-to-end speedups arise only when compression preprocessing, hardware and prompt length align. Non-agent workloads. |
| [vCache: Verified Semantic Prompt Caching](https://proceedings.iclr.cc/paper_files/paper/2026/hash/9559cd2116de7a8f5672eac3fcd232cc-Abstract-Conference.html) (2026; ICLR) | Calibrates cache reuse to user-specified error rates on studied prompts. Reusing a patch across repository revisions would need a different safety model. |
| [On the Impacts of Contexts on Repository-Level Code Generation](https://aclanthology.org/2025.findings-naacl.82/) (2025; NAACL Findings) | Full dependency context can outperform aggressively pruned context in repository code generation. |
| [Cost-Efficient Serving of LLM Agents via Test-Time Plan Caching](https://arxiv.org/abs/2506.14852) (Jun 2025) | Reuses adapted plan templates across related agent tasks; reported cost savings depend on task similarity and changing external state. |
| [LLMLingua-2](https://arxiv.org/abs/2403.12968) (2024) | Learned extractive prompt compression; coding constraints and hard requirements need direct preservation checks. |
| [Repoformer](https://arxiv.org/abs/2403.10059) (2024) | Selective retrieval speeds repository code completion in studied benchmarks; narrower than multi-step fixes. |
| [RLCoder](https://arxiv.org/abs/2407.19487) (2024) | Retriever with a stop signal improves code-completion exact match; accepted-task transfer unproven. |

## 4. Serving, local inference and energy

These are relevant if Anvilmark compares user-operated deployment options. Most improve capacity or latency on a particular stack; none automatically lowers a metered API bill.

| Study | Evidence and practical limit |
| --- | --- |
| [Green AI: Cost of LLM-Based Code Completion](https://arxiv.org/abs/2609.33918) (Sep 2026) | 25 open models across two completion workloads: input and output energy drivers differ by task; small quantized models can be Pareto-efficient. Not full coding agents. |
| [Inference Economics of Enterprise Coding Agents](https://arxiv.org/abs/2607.13080) (Jul 2026) | One-developer longitudinal local/cloud case study; utilization, caching and repair burden affect total cost. Nonrandomized and confounded. |
| [Token-Budget-Aware Pool Routing](https://arxiv.org/abs/2604.09613) (2026) | Simulator and traffic traces project fleet GPU savings from short/long request pools; not a user-site field deployment. |
| [Tail-Optimized Caching for LLM Inference](https://papers.nips.cc/paper_files/paper/2025/hash/f05fe8b796dcbd67bc7bb1ea89df1793-Abstract-Conference.html) (2025; NeurIPS) | Changes KV-cache eviction to favor high-latency conversations; serving-stack feature, not API prompt-cache policy. |
| [Green My LLM](https://arxiv.org/abs/2411.11892) (2024) | Developer traces suggest rejected/cancelled completions can waste inference; simulation and model configuration bound transfer. |
| [Energy Considerations of LLM Inference and Efficiency Optimizations](https://aclanthology.org/2025.acl-long.1563/) (2025; ACL) | Measured energy depends on workload, hardware, software and batching; useful for hardware-fit calibration. |
| [EAGLE-3](https://arxiv.org/abs/2503.01840) (2025) | Speculative decoding speeds supported backends; higher throughput need not reduce provider charges. |
| [PagedAttention / vLLM](https://arxiv.org/abs/2309.06180) (2023) | Better KV-cache management improved throughput versus then-current baselines; infrastructure rather than Anvilmark's direct feature. |
| [Calibrate, Then Route](https://arxiv.org/abs/2609.16206) (2026) | Hardware-specific calibration changes scheduling decisions; benefits can vanish in a small pool. Relevant to measurement, not proof of universal router gain. |
| [HW-Router](https://arxiv.org/abs/2608.14575) (2026) | Hardware, queues and KV pressure affect latency-aware scheduling; applicable to self-hosted fleets with runtime telemetry. |

## 5. Budgeting, measurement and adjacent decisions

| Study | Evidence and practical limit |
| --- | --- |
| [Adaptive Test-Time Compute Allocation for Reasoning LLMs](https://arxiv.org/abs/2604.14853) (Apr 2026) | Trains a lightweight classifier to allocate extra reasoning under a global budget; evaluated on math, not coding agents. |
| [Budget-Aware Tool Use Enables Effective Agent Scaling](https://research.google/pubs/cost-effective-agent-test-time-scaling/) (2026; COLM) | Allocates agent tool/exploration budget; tool workloads differ from accepted repository patches. |
| [Scores Are Not Decisions](https://arxiv.org/abs/2607.27083) (Jul 2026) | Studies cost-aware tool selection and stopping on multi-domain tasks; needs coding-specific acceptance checks. |
| [CostRoute](https://ieeexplore.ieee.org/document/11569559/) (2026) | Vision paper for predicting output-token distributions before API dispatch; proposed evaluation, not established savings. |
| [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640) (2024) | Paired evaluation uncertainty and sample-size reasoning; needed before declaring one cost-quality policy a winner. |

## What this suggests building

The strongest candidate is a **local cost-per-accepted-task lab**, connected to Anvilmark's existing development plan, run and human review records. It would (1) attribute billed and allowance usage by model/configuration, cache class, turn, tool, context source and retry; (2) compare a proposed intervention against a frozen baseline on matched tasks; (3) show quality, elapsed time, review/rework, and cost together; (4) record the cost of acquiring evaluation labels; and (5) recommend only when a measured gain survives uncertainty and hard restrictions. Candidate interventions include a better task brief, verified context handoff, selected skill, check plan, cache-friendly prompt structure, early-stop rule, fixed model, or model cascade.

Anvilmark's current [`development recommend`](../../packages/cli/README.md) already records exact configurations and reviewed outcomes, but the [pilot observation](development-selection-observation-2026-10-17.md) is one task with two subscription runs. It cannot support a savings claim or a trained router yet. The first useful experiment is a small set of frozen repository tasks comparing a fixed setup against one changed task brief or handoff, then a second experiment comparing configurations with the same brief and checks.

**Product boundary:** this would be an evidence-backed developer decision feature, not a generic price-table optimizer or an inference server. Application-runtime optimization can reuse its experiment and provenance methods but needs measured workload traces, actual billing, latency and quality gates of its own. Previous broad cost-auditor ideas in this repository were closed after competitor research; this proposal needs fresh user validation rather than assuming a product gap.

**Deliberately excluded from positive evidence:** [CodeRescue](https://arxiv.org/abs/2607.19338) was withdrawn, and T2MO and Triage are methods/proposals rather than measured cost reductions. Headline paper savings should never be carried into Anvilmark forecasts without reproducing the workload, model identities, provider accounting and acceptance criteria.
