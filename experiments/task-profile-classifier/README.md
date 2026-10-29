# Coding-task type classifier research

This experiment tests a compact local classifier on real software issue text.
It is a **research prototype** for Anvilmark task-kind suggestions; it does not
choose a coding model or alter `anvilmark development` plans.

## What we measured

The model sees an issue title and the first 2,000 body characters. It predicts
one of `bug`, `feature`, `question`, or `documentation`. The 2023 NLBSE dataset
supplies 60,000 selected training rows, 8,000 validation rows, and the full
142,320-row publisher test. Exact duplicate text is removed across our
training/validation samples. The [protocol](PROTOCOL.md) records the choices
and preparation amendments made before opening the test labels.

| Held-out dataset | Majority accuracy / macro-F1 | Linear accuracy / macro-F1 | MiniLM accuracy / macro-F1 |
| --- | ---: | ---: | ---: |
| NLBSE'23 official test, 142,320 issues | 52.5% / 0.172 | 83.7% / 0.664 | **86.2% / 0.738** |
| NLBSE'24 independent test, 1,500 issues | — | 58.8% / 0.531 | **67.7% / 0.645** |

The NLBSE'24 source has only `bug`, `feature`, and `question`. Predicting
`documentation` there counts as an error. Its five repositories are balanced;
the model was **not retrained** or recalibrated for them. Exact text overlap
with selected NLBSE'23 training data was 2,177 of 142,320 on the 2023 test and
5 of 1,500 on the 2024 test. MiniLM macro-F1 after excluding exact overlaps
was 0.737 and 0.645 respectively, so those overlaps do not explain the
cross-dataset drop.

For bug/feature suggestions, validation chose a threshold targeting 95%
precision. On the NLBSE'23 test, MiniLM emitted suggestions for **67.4%** of
issues at **94.75%** precision. On the independent NLBSE'24 test, it emitted
for **58.9%** at only **76.24%** precision. The threshold did not transfer.
The 2024 set has many `question` issues describing broken behavior; the model
often calls them bugs. This is a mix of model error and project-label ambiguity.

The selected MiniLM checkpoint was epoch 1 of 2, chosen by validation
macro-F1. Training took 373 seconds on the 6 GB RTX 4050. On the 2023 test,
100 warm single-request MiniLM calls took 6.3 ms median and 9.8 ms p95,
including tokenization but excluding load. The linear model took about 1.0 ms
median. These are local engineering timings, not end-to-end task savings.

The publisher's [NLBSE'23 baseline](https://github.com/nlbse2023/issue-report-classification)
reported 0.851 micro-F1 for FastText and 0.891 for RoBERTa. Our MiniLM reached
0.862 micro-F1 with a 60,000-row sample rather than the baseline's full
training set. This is **not** a controlled ranking or a state-of-the-art claim.
The [NLBSE'24 SetFit baseline](https://github.com/nlbse2024/issue-report-classification)
trained separate models on its own per-repository data, so its 0.827 reported
mean F1 is likewise not directly comparable to our zero-shot transfer check.

The complete [2023 report](results/official-test.json) and [2024 transfer
report](results/external-nlbse24-test.json) are local, ignored artifacts. They
include class metrics, confusion matrices, overlap audits, and timing.

## Reproduce

Use the Python environment from the sibling decision-model experiment. It
contains PyTorch CUDA, Transformers, scikit-learn, NumPy, and joblib. The
archive and source hashes are fixed in `data.py`; the model's base revision is
fixed in `train.py`.

```sh
python3 experiments/task-profile-classifier/download_parallel.py \
  https://tickettagger.blob.core.windows.net/datasets/nlbse23-issue-classification-train.csv.tar.gz \
  experiments/task-profile-classifier/.cache/nlbse-train.csv.tar.gz
python3 experiments/task-profile-classifier/download_parallel.py \
  https://tickettagger.blob.core.windows.net/datasets/nlbse23-issue-classification-test.csv.tar.gz \
  experiments/task-profile-classifier/.cache/nlbse-test.csv.tar.gz
curl -fL \
  https://raw.githubusercontent.com/nlbse2024/issue-report-classification/2927bc67eb42db8affd16eaf3e5a6d74f3063961/data/issues_test.csv \
  -o experiments/task-profile-classifier/.cache/nlbse24-test.csv

experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/data.py prepare
experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/train.py linear
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/train.py minilm
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/evaluate.py
HF_HUB_OFFLINE=1 experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/eval_transfer.py
```

The training archive is from NLBSE'23 repository revision
`34c5e0c01968752c822849f0e0d82601e16403df`. Its SHA-256 is
`090d64c456b47b26314ac3abac559928167e0f0830da68e1461de2fcb355d42d`;
the 2023 test archive is
`f625dc78af6139b94623004dcbe575b5dfb6dc3293b7e9fa2fa109352d1cdf0e`.
The NLBSE'24 CSV is pinned to commit
`2927bc67eb42db8affd16eaf3e5a6d74f3063961` and SHA-256
`4f7d8619d4e5adbea126e548fd8c214449288f3a93bb3bc130c54cd307af7e85`.

## Product decision

Do not integrate this checkpoint into automatic routing. The independent
transfer loss, weak `question` performance, four-versus-six label mismatch,
and publisher-label noise leave the real Anvilmark task-type accuracy unknown.
Next, collect independently reviewed Anvilmark examples for all six `kind`
labels and assess whether a task-kind suggestion actually saves planning time.
For coding-model routing, compare accepted outcomes and cost per completed
task against fixed cheap and fixed strong defaults, including retries.

`collect_review_queue.py` exports local development plans to an ignored JSON
review queue. It leaves `reviewed_kind` empty even when the plan declares a
kind, so a reviewer can make an independent judgment. For example:

```sh
experiments/decision-model/.venv/bin/python \
  experiments/task-profile-classifier/collect_review_queue.py \
  --plans-dir /path/to/project/.anvilmark/development/plans
```

The output stays under `.cache/` by default and may contain private task text;
review it locally before sharing it or using it in training.

The public competition repository is AGPL-3.0, and separate rights for its
GitHub-derived issue corpus are unclear. The 2024 repository's `LICENSE` file
is empty. Downloads and checkpoints remain ignored local research artifacts;
production distribution needs a separate rights review.
