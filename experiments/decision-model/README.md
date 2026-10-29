# Decision-model research

This folder holds the first steps toward an Anvilmark-owned classifier with
caller-defined labels. [RESEARCH.md](RESEARCH.md) explains the papers, model
options, evaluation rules, and proposed experiments. Nothing here changes
Anvilmark's production model recommendations.

## What runs now

The dependency-free lexical model is an intentionally weak floor:

```sh
node experiments/decision-model/run-local.mjs
```

The open-weight GLiClass edge checkpoint is a stronger external baseline. It
uses the same [question definitions](../jev-task-profile/questions.json) and
case file as the Jev experiment. It is pinned to revision
`df03993a2ed98e5e4a0d2dd7efbbd105abe874cf` and runs on the CPU:

```sh
python3 -m venv experiments/decision-model/.venv
experiments/decision-model/.venv/bin/pip install --no-cache-dir torch \
  --index-url https://download.pytorch.org/whl/cpu
experiments/decision-model/.venv/bin/pip install --no-cache-dir \
  'gliclass==0.1.17' 'transformers==4.57.6'
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/run-open-baseline.py
```

The checkpoint is downloaded into ignored `.cache/`. Results are written to
ignored `results/` and contain labels, probabilities, timing, model revision,
and hardware settings, but not task descriptions. The displayed probabilities
have **not** been calibrated for these tasks. Local CPU cost is not measured.

Use `--cases FILE` with independently reviewed labels to evaluate meaningful
accuracy. The bundled six labels are illustrative; see [EVIDENCE.md](EVIDENCE.md)
for the first smoke run and its limits. The sibling
[Jev experiment](../jev-task-profile/README.md) can run the same cases once a
TypeSafe API key is available.

## Train a small classifier

`train-dynamic-label.py` is our first learned candidate for caller-defined
Choice labels. It uses a frozen, Apache-2.0
[MiniLM sentence encoder](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
and trains a 384 × 384 projection on top. The project owns the projection and
training code; the encoder remains a third-party pretrained checkpoint. The
benchmark is [BANKING77](https://huggingface.co/datasets/PolyAI/banking77),
listed as CC-BY-4.0. Its 77 category names are split into disjoint training,
validation, and test groups. Each group is evaluated only among its own label
names; the test result is a 14-choice task, not a 77-choice task.

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/fetch-banking77.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/train-dynamic-label.py
```

The fetch script pins the dataset revision and checks file hashes. The training
script pins the encoder revision. Downloads, the learned checkpoint, and
detailed reports stay in ignored `.cache/` and `results/`. It uses the first 30
examples in each selected category from the official train or test files, a
fixed random split of category names, and four CPU threads by default. It
selects the training epoch and blend with the original embeddings on validation
categories, then reports performance on untouched test categories. See
[EVIDENCE.md](EVIDENCE.md) for the measured result and limitation.

The saved prototype can score any supplied list of text labels:

```sh
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/decision-model/train-dynamic-label.py \
  --predict 'My new card has not arrived yet' \
  --labels '["card arrival", "cash withdrawal charge", "change pin"]'
```

Its reported probabilities were calibrated only on BANKING77 validation
categories. They are not reliable for arbitrary domains. This prototype
supports Choice; Noul and Score need their own data and evaluation before the
learned model can support them.

For an untouched domain check, run the pinned English test split of
[MASSIVE](https://huggingface.co/datasets/AmazonScience/massive) through the
same saved head:

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-massive.py
```

The test file is fetched from a pinned MTEB mirror revision and checked against
its SHA-256. No MASSIVE examples or labels are used to fit the BANKING77 head
or select its blend. The original MASSIVE dataset is listed as CC-BY-4.0.

## Fine-tune the query encoder on the RTX 4050

`train-question-encoder.py` is a second learned candidate. It keeps the label
encoder frozen, fine-tunes the MiniLM query encoder against dynamic labels,
and anchors its output to the original encoder. Its input includes an explicit
question. The available 4050 has 6 GB VRAM; this model fits comfortably. The
project virtual environment now has PyTorch `2.14.1+cu130`. A compatible
NVIDIA driver is required, and GPU runs need access to `/dev/nvidia*`.

```sh
experiments/decision-model/.venv/bin/python -m pip install --no-cache-dir \
  'torch==2.14.1+cu130' --index-url https://download.pytorch.org/whl/cu130
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/gpu-preflight.py
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/decision-model/train-question-encoder.py --device cuda
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-question-encoder.py --device cuda
```

The preflight can report CUDA unavailable inside a restricted workspace even
when a normal terminal can access the GPU. The trained checkpoint and reports
stay in ignored `.cache/` and `results/`. The second evaluation uses MASSIVE's
English intent test and is exploratory because this project has already
inspected that test split. Neither model's probabilities have been calibrated
for MASSIVE. See [EVIDENCE.md](EVIDENCE.md) before interpreting the scores.

## Larger, two-dataset GPU run

`train-multidomain.py` fine-tunes the same MiniLM encoder with both raw messages
and question-form messages. It uses 1,500 BANKING77 training examples and
11,514 MASSIVE English training examples, repeating the smaller banking set
four times per epoch to balance the two domains. The frozen label encoder still
accepts caller-defined labels. The checkpoint is selected using only BANKING77
and MASSIVE validation results. The CLINC150 dataset is excluded from training
and selection.

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/train-multidomain.py --device cuda
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/fetch-clinc150.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-clinc150.py --device cuda
```

The [original CLINC150 dataset](https://github.com/clinc/oos-eval) is pinned to
commit `828f8093932c8fe6ca7936c3d2e52903b1c523de`, checked against a
SHA-256 in the evaluation script, and cached at `.cache/clinc150/data_full.json`.
Its original repository uses CC-BY-3.0. The first held-out run scored 4,500
in-scope examples across 150 labels and 1,000 out-of-scope examples. See
[EVIDENCE.md](EVIDENCE.md) for the result and its limits. No CLINC150 examples
were used to fit or choose this checkpoint.

`eval-shortlist-clinc.py` is an optional external-model diagnostic. On one
CLINC150 **training** example per intent, it retrieves 20 labels with frozen
MiniLM and reranks them with the pinned GLiClass edge checkpoint. The default
uses only the training split, so it does not repeat the held-out test:

```sh
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-shortlist-clinc.py --device cuda --split train
```

The reranker reduced accuracy on that diagnostic sample; its result is in
[EVIDENCE.md](EVIDENCE.md). The GLiClass edge checkpoint is an external model,
and this diagnostic is separate from our trained candidate.

## Train and use the label-aware reranker

`train-reranker.py` is our next learned candidate. Frozen raw-input MiniLM
retrieves eight candidate labels. A trainable MiniLM pair encoder then reads
the message together with each candidate and reranks them. It learns from
BANKING77 and MASSIVE training splits with hard negative labels. Epoch and
rank-fusion weight are selected using only their validation data; see the
[predeclared protocol](NEXT-PROTOCOL.md). This is an intent classifier with
caller-defined labels, not a general Jev replacement yet.

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/train-reranker.py --device cuda
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/fetch-hwu.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-hwu.py --device cuda
```

The new untouched test uses the [original HWU annotated
corpus](https://github.com/xliuhw/NLU-Evaluation-Data), pinned to commit
`f6071b496b17d71e6eb43f543af0707f4ff30557` and checked against the
SHA-256 in `fetch-hwu.py`. The original repository says CC-BY-4.0. Its
original-source scenario and intent pairs yield **68 labels**, so this is not
the canonical preprocessed HWU64 benchmark. Exact messages seen in either
training corpus are removed before scoring. See [EVIDENCE.md](EVIDENCE.md).

Use the saved checkpoint on a caller-defined label set:

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/predict-reranker.py --device cuda \
  --text 'wake me up at six tomorrow' \
  --labels '["alarm set", "weather query", "music play", "email send"]'
```

`DynamicLabelClassifier` in `predict-reranker.py` caches label vectors with
`set_labels()` and can serve several `predict()` calls. Returned scores are
**ranking values, not probabilities**. The model accepts two labels, but has
not been calibrated for binary questions. Ordered scores remain unreliable in
the held-out transfer check below. Run `bench-reranker.py` for a warm single-request
latency measurement with 77 cached labels.

The fixed checkpoint also has a transfer check on the official
[GoEmotions](https://github.com/google-research/google-research/tree/master/goemotions)
test split, pinned and hash-checked by `fetch-goemotions.py`. Its original
repository states that datasets are CC-BY-4.0. The check uses single-label
emotion examples and the publisher's coarse positive/negative mapping:

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/fetch-goemotions.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-goemotions.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/bench-reranker.py
```

Detailed reports and checkpoints remain in ignored `results/` and `.cache/`.
No HWU, GoEmotions, or Query-wellformedness examples were used for training or
checkpoint selection.

We also evaluated a fixed six-level score choice on the publisher's
[Query-wellformedness](https://github.com/google-research-datasets/query-wellformedness)
test split. Its original repository states CC BY-SA 4.0. `fetch-wellformedness.py`
pins the revision and SHA-256. The dataset contains 13 ratings between the
main 0.2 steps; the [protocol](NEXT-PROTOCOL.md) records the format amendment
made before model inference. The model was worse than a constant midpoint
prediction on this task, so the checkpoint should **not** be used for general
ordered Score questions.

```sh
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/fetch-wellformedness.py
experiments/decision-model/.venv/bin/python \
  experiments/decision-model/eval-wellformedness.py
```
