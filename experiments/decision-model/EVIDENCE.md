# Initial experiment record

Date: 2026-10-17. Dataset: six illustrative Anvilmark task descriptions in
[`cases.sample.json`](../jev-task-profile/cases.sample.json). The labels have
not been independently reviewed, so the agreement rates below measure only
whether the scripts execute and expose obvious weak spots.

| Model                                          | Kind agreement | Risk agreement | Both |   Mean warm inference |
| ---------------------------------------------- | -------------: | -------------: | ---: | --------------------: |
| Local lexical baseline 0.1                     |            3/6 |            2/6 |  0/6 |            below 1 ms |
| GLiClass edge v3.0, pinned revision `df03993a` |            3/6 |            4/6 |  2/6 | 59–144 ms on this CPU |

The GLiClass run used `gliclass==0.1.17`, `transformers==4.57.6`, CPU PyTorch
2.14.1, four CPU threads, and single-label inference. Model loading took
about 11.4 seconds on the first run. Its question labels include the same names
and descriptions prepared for Jev, and the prepared state text is identical. Measured p95
warm inference across these six cases was 239 ms. A later offline run with the
same pinned checkpoint loaded in 0.8 seconds and measured 59 ms mean and 102 ms
p95. These small runs show variability, not a stable latency distribution.

Jev has not been run because `TYPESAFE_API_KEY` is absent. There is no
head-to-head quality, calibration, or cost result yet. Neither model in the
six-case smoke test was trained by us. The next evidence gate is a larger human-reviewed test set
with held-out label sets and domains, followed by a pinned Jev comparison.

## First trained candidate

We trained a small 384 × 384 dynamic-label projection over frozen MiniLM
embeddings on the public BANKING77 dataset. Fifty category names supplied
training examples; thirteen different names supplied validation examples and
selected the epoch and blend; fourteen further names supplied the untouched
test. Each group had 30 examples per category from the dataset's official
train or test split. The model selected among the labels in its own group, so
the test below is a **14-way** choice task. The dataset and encoder revisions
are pinned in the scripts and report. The dataset is listed as CC-BY-4.0 and
the encoder as Apache-2.0 by their publishers.

| Held-out test, 420 examples   | Accuracy | Macro-F1 | Brier score |
| ----------------------------- | -------: | -------: | ----------: |
| Untouched MiniLM cosine score |    83.3% |    0.835 |       0.246 |
| Learned projection alone      |    79.3% |    0.784 |       0.285 |
| Validation-selected blend     |    82.1% |    0.819 |       0.254 |

The selected blend improved validation accuracy from 80.5% to 86.7%, but
slightly **reduced** test accuracy compared with the untouched encoder. This
is evidence that adaptation on one group of intents did not reliably transfer
to another group in this first run. We will not tune against these test labels.
Embedding 2,310 examples and 77 labels took 13.3 seconds; training the
projection took 0.46 seconds on four CPU threads. The pretrained encoder
required a separate download and was not trained here. These timings describe
this small prototype, not the cost of reaching Jev-level breadth.

## Untouched domain check

We then evaluated the frozen BANKING77 head on the English MASSIVE intent test
split: 2,974 examples, 59 available labels. Its labels and examples played no
part in training or selecting the head. The untouched encoder reached **51.2%**
accuracy and **0.452** macro-F1. The validation-selected blend reached **51.4%**
accuracy and **0.450** macro-F1. The projection alone reached **50.8%** accuracy
and **0.443** macro-F1. The 0.2 percentage point accuracy difference is too
small to treat as a meaningful gain, and macro-F1 was slightly worse. This is
one domain check, not general parity evidence. Probabilities are not calibrated
for MASSIVE. The dataset file, mirror revision, and original CC-BY-4.0 license
are recorded in the evaluation script and report.

The practical next step is to train on multiple independent domains and hold
back entire domains and label sets for evaluation. The current head supplies a
working training and measurement path, but its transfer is not yet better than
the frozen encoder.

## RTX 4050 query-encoder experiment

After the matching NVIDIA module was installed for kernel `7.0.0-38-generic`,
an outside-sandbox preflight detected the RTX 4050 (6,141 MiB) and PyTorch
`2.14.1+cu130`. We fine-tuned all MiniLM query-encoder weights for three epochs
on the same 50 BANKING77 training categories. Labels were encoded by a frozen
copy of the original encoder. An anchoring loss penalized drifting too far from
the original query embedding. The input question was “Which intent best
describes this message?” and the batch size was 16. The three training epochs
took 8.9 seconds on the GPU, excluding model loading and data preparation.
Validation selected epoch 1.

| Split and setup | Untouched query encoder | Fine-tuned query encoder |
| --- | ---: | ---: |
| BANKING77 validation, 390 examples, 13 choices, prompted | 77.4% | 82.3% |
| BANKING77 exploratory test, 420 examples, 14 choices, prompted | 76.0% | 80.5% |
| MASSIVE English exploratory test, 2,974 examples, 59 choices, prompted | 39.9% | 45.0% |
| MASSIVE English exploratory test, 2,974 examples, 59 choices, raw message | 51.2% | 50.9% |

The MASSIVE run took 1.03 seconds for the untouched query encoder and 0.94
seconds for the fine-tuned encoder at batch size 32, excluding loading. The
fine-tuned model improved relative to the *same prompted input*. A separate
raw-message diagnostic reproduced the earlier **51.2%** frozen MiniLM result;
the fine-tuned model reached **50.9%** with raw messages. The prompt itself
reduced accuracy substantially on this domain, and training on banking did not
improve the strongest same-format baseline. The BANKING77 test categories and
MASSIVE test split were already inspected during earlier experiments; neither
is a fresh test for this candidate. We did not fit or select this checkpoint
using those scores. Probabilities are uncalibrated, and no Jev comparison has
been run. Multi-domain training and a new untouched evaluation domain are the
next evidence gate.

## Two-dataset GPU run and held-out CLINC150 test

We next trained one MiniLM query encoder on **1,500 BANKING77 training examples**
and **11,514 MASSIVE English training examples**. Each raw message was paired
with a question-form version during training. The smaller banking set was
repeated four times per epoch. Three epochs took **71.3 seconds** on the 4050,
including validation; epoch 3 was selected by the mean raw-input accuracy on
BANKING77 and MASSIVE validation splits. No CLINC150 data was used to train or
select the checkpoint. The public MASSIVE mirror files are pinned and
SHA-256 checked in the training script.

We then ran an **initial held-out test** on the [original CLINC150
dataset](https://github.com/clinc/oos-eval), pinned to commit
`828f8093932c8fe6ca7936c3d2e52903b1c523de` and SHA-256
`36923c3705a59e08fe9c3883d8bc2dd966ef93e22cb78ac41171782a698d56e0`.
The [original repository license](https://github.com/clinc/oos-eval/blob/master/LICENSE)
is CC-BY-3.0. The test contains 4,500 in-scope examples across 150 labels and
1,000 out-of-scope examples. The latter were used only for evaluation.

An exact-text audit after that first run found **27** in-scope CLINC150 test
messages and **one** out-of-scope message matching MASSIVE training text after
lowercasing and collapsing whitespace. None matched the selected BANKING77
training rows. We reran the **same fixed checkpoint**, without retraining or
changing selection, and excluded the 27 in-scope matches from an additional
accuracy calculation. On the remaining **4,473** examples, raw accuracy was
**68.4%** for untouched MiniLM and **68.1%** for the trained encoder;
question-form accuracy was **56.4%** and **65.9%**. The paired improvement for
question-form input remained **9.4 points** (95% bootstrap interval **8.1 to
10.7 points**). The original out-of-scope AUROC figures include the one
matching message. The audit does not change the conclusion.

| CLINC150 test input | Untouched accuracy | Trained accuracy | Change | Paired 95% bootstrap interval for change |
| --- | ---: | ---: | ---: | ---: |
| Raw message | 68.4% | 68.1% | −0.3 points | −1.3 to +0.8 points |
| Question-form message | 56.5% | 65.9% | +9.5 points | +8.2 to +10.7 points |

Macro-F1 on question-form messages rose from 0.559 to 0.633. On raw messages it
was essentially unchanged (0.660 to 0.656). Out-of-scope AUROC using negative
maximum softmax probability rose from **0.846 to 0.856** on raw inputs and from
**0.811 to 0.854** on question-form inputs. These probabilities are **not
calibrated** for CLINC150, and AUROC does not establish a safe rejection
threshold. Raw untouched MiniLM remained the strongest accuracy result on this
held-out corpus. The training improved question-form robustness, but it did not
improve the best raw-input baseline. We will not tune another checkpoint against
this CLINC150 test split and call it fresh evidence.

### External reranker diagnostic

The pinned GLiClass edge checkpoint has a default configuration of 25 classes,
so we tested a two-stage setup on **one CLINC150 training example per intent**:
frozen MiniLM shortlisted 20 of the 150 labels, then GLiClass chose among
those 20. The correct label was in the shortlist for **95.3%** of the 150
examples. MiniLM's first choice was correct for **68.0%**. GLiClass reranking
reduced accuracy to **47.3%** without a task prompt and **45.3%** with the
generic intent question. This is a small training-split diagnostic, not a
held-out performance estimate. We did not run the GLiClass reference on the
full CLINC150 test because its reranker result was already substantially worse
on this diagnostic. The checkpoint is external and not part of our trained
model.

## Label-aware reranker and new-domain checks

We trained a message-and-label pair encoder on **1,500 BANKING77** and
**3,332 MASSIVE** training messages. Each training query had its correct label,
two difficult labels from frozen MiniLM retrieval, and one sampled negative.
Frozen MiniLM supplied an eight-label shortlist at inference. The pair encoder
read each message with each shortlist label; rank fusion combined its choice
with the retriever's order. Three epochs took **85.0 seconds** on the RTX 4050,
including validation. Epoch 2 and fusion weight 0.75 were chosen by the mean
top-one accuracy on BANKING77's unseen-label validation set and MASSIVE's
official validation split. The [protocol](NEXT-PROTOCOL.md) was recorded before
HWU or GoEmotions scoring.

| Validation | Frozen retriever | Selected pair reranker | Correct label in top eight |
| --- | ---: | ---: | ---: |
| BANKING77 unseen labels, 390 messages | 80.5% | 85.4% | 99.7% |
| MASSIVE, 2,033 messages | 53.6% | 67.2% | 82.6% |

The new held-out domain was the [original HWU home-domain annotated
corpus](https://github.com/xliuhw/NLU-Evaluation-Data), pinned to commit
`f6071b496b17d71e6eb43f543af0707f4ff30557` and the SHA-256 in
`fetch-hwu.py`. The [publisher's repository](https://github.com/xliuhw/NLU-Evaluation-Data)
states CC-BY-4.0. We formed labels from scenario and intent, yielding **68
labels**, rather than reproducing the canonical HWU64 preprocessing. The
predeclared deterministic sample had 1,999 messages. **375** matched MASSIVE
training text after lowercasing and whitespace normalization, while none
matched selected BANKING77 training text. We excluded those 375 from the
accuracy comparison. The remaining **1,624** messages had these results:

| HWU original-source test | Accuracy | Macro-F1 |
| --- | ---: | ---: |
| Frozen retriever | 52.4% | 0.476 |
| Pair reranker alone on eight-label shortlist | 63.5% | 0.611 |
| Validation-selected rank fusion | **64.8%** | **0.619** |

The selected system improved accuracy by **12.4 percentage points** over its
frozen retriever (paired bootstrap 95% interval **10.1 to 14.7 points**).
The correct label was in the eight-label shortlist **84.7%** of the time, so
retrieval misses cap this two-stage design. The large exact-overlap count
suggests related source material between HWU and MASSIVE; excluding exact
matches does not rule out near-duplicates or shared phrasing. This result is
promising for intent transfer, with that qualification. The first HWU
evaluation invocation failed while formatting macro-F1, after inference but
before writing any scores. The same fixed checkpoint and protocol produced
the completed report after correcting the metrics call.

To test transfer beyond intent labels, we used Google's official
[GoEmotions test split](https://github.com/google-research/google-research/tree/master/goemotions),
with pinned revision and SHA-256 files listed in `fetch-goemotions.py`. The
[repository](https://github.com/google-research/google-research) states that
its datasets are CC-BY-4.0. Only examples with exactly one emotion annotation
were eligible. The checkpoint and fusion weight were unchanged; zero selected
examples exactly matched either training corpus.

| New question type | Test size | Frozen retriever | Selected system | Paired 95% interval for accuracy change |
| --- | ---: | ---: | ---: | ---: |
| 28-way emotion choice | 1,195 | 20.3% | 20.6% | −1.8 to +2.5 points |
| Positive/negative from publisher's emotion mapping | 1,932 | 67.4% | 71.6% | +1.6 to +6.6 points |

The positive/negative target is a **coarse mapping from emotion annotations**,
not an independently labeled sentiment benchmark. On fine-grained emotion,
macro-F1 fell from 0.189 to 0.185 and the accuracy difference is consistent
with no improvement. Binary transfer worked better in this narrow test; it
does not establish reliability for arbitrary yes/no questions.

For an ordered Score check, we used the publisher's
[Query-wellformedness test split](https://github.com/google-research-datasets/query-wellformedness),
pinned to commit `fb69c21416195cddc797277ea9e4d393226571d2` and the
SHA-256 in `fetch-wellformedness.py`. The source states CC BY-SA 4.0. Its
**3,850** queries have a human well-formedness score between 0 and 1. Six
fixed label phrases represented scores 0, 0.2, ..., 1; zero test messages
exactly matched training text. The first attempt stopped during source format
validation, before model inference, because **13** ratings were off that
grid. The [protocol](NEXT-PROTOCOL.md) records the pre-inference amendment:
keep the original fractional values for mean absolute error and use the nearest
0.2 step only for exact-choice accuracy.

| Well-formedness score method | Mean absolute error on 0–1 scale | Exact six-level accuracy |
| --- | ---: | ---: |
| Constant 0.5 | **0.345** | not applicable |
| Frozen retriever | 0.469 | 19.0% |
| Pair reranker alone | 0.406 | 16.9% |
| Validation-selected rank fusion | 0.408 | 16.8% |

Rank fusion improved MAE over its own retriever by **0.061** (paired 95%
bootstrap interval **0.048 to 0.073** improvement), but it remained **worse
than always outputting 0.5**. This is a clear failure to transfer to this
ordered criterion. We should train and validate a Score model on actual
ordered data before exposing one. Probability calibration, abstention
thresholds, and Jev parity also remain untested.

A callable prediction path is in `predict-reranker.py`. On this 4050, 100 warm,
single-message predictions with **77 cached label choices** and an eight-label
shortlist took **6.4 ms median**, **9.7 ms p95**, and **7.1 ms mean**. Model
loading took 6.5 seconds, label setup 0.19 seconds, and PyTorch peak allocated
memory was about 197 MiB during this run. The timing uses five repeated short
messages, one process, and excludes loading and label setup; it is an
engineering diagnostic, not a production latency guarantee. Returned scores
are ranks and raw logits, not calibrated probabilities.
