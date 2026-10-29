# Coding-task type experiment: fixed protocol

Recorded before opening the NLBSE test labels or fitting a model.

## Question and scope

Can a compact, local classifier distinguish issue types in real software
development text? This is a proxy for **task-type suggestions**, not a test of
Anvilmark's six-way task taxonomy or coding-model routing. The public target is
four labels: `bug`, `feature`, `question`, and `documentation`. Only the first
two map directly to Anvilmark's current `kind` labels.

## Data and split

- Use the NLBSE'23 issue-report-classification publisher's training and test
  archives, downloaded from links in its archived repository. Record archive
  SHA-256 values and row counts after download.
- Inputs are issue title plus the first 2,000 characters of body. Do not use
  issue ID, labels, or author association as model features. Remove Markdown
  issue-template boilerplate only if a rule is defined from training data.
- Select 60,000 training and 8,000 validation records from the publisher's
  training archive by the smallest SHA-256 values of `id`, using seed prefix
  `anvilmark-nlbse23-v1`. The sets are disjoint. Select without looking at
  text or class so that the published class distribution is retained.
- **Pre-training preparation amendment:** the first extraction attempt found
  a repeated issue ID (`909743879`) and stopped before model fitting or test
  scoring. Keep the first record for each training ID and exclude IDs whose
  repeated rows have conflicting labels. Report repeated IDs and conflicts.
  This prevents the same issue from entering both training and validation and
  avoids choosing an arbitrary label for a disputed ID. A 1,000-row hash-rank
  buffer is kept so excluded IDs do not reduce the target sample size.
- **Pre-selection duplicate-text amendment:** an audit of the first sample
  found 107 validation descriptions identical to training descriptions after
  lowercasing and whitespace normalization. GPU training was stopped before
  checkpoint selection, and the linear result was discarded. Select only the
  first occurrence of each normalized title/body text in hash rank order,
  then rebuild both samples and retrain. The publisher's test labels remained
  unopened.
- Train and select on these two samples only. Evaluate **all** 142,320 rows in
  the publisher's test archive once, after model and decision rules are fixed.
- Audit exact normalized title/body overlap between selected train and test
  records and report it. Report both the full official-test score and a
  diagnostic score after excluding exact selected-train text overlaps, using
  the same fixed predictions. The archive lacks a repository identifier, so a
  repository-held-out score cannot be claimed.

## Models and selection

- Majority-class baseline, fitted from the 60,000 training labels.
- Word unigram/bigram TF-IDF plus logistic regression, fitted to the same
  60,000 training records. The vectorizer has 200,000 maximum features,
  `min_df=2`, sublinear TF, and one fixed random seed.
- Fine-tune `sentence-transformers/all-MiniLM-L6-v2` with a four-class linear
  head for two epochs, maximum 192 tokens, batch 32, AdamW at 2e-5,
  four-class cross-entropy, and seed 17. Select epoch by validation macro-F1
  (ties choose the earlier epoch). Use the same 60,000 examples.
- Select the **better of linear and MiniLM** on validation macro-F1; do not
  change any training choice after test scoring. Report both on the full test,
  plus the majority baseline.
- For `bug`/`feature` suggestions, choose a confidence threshold on validation
  for each trained model: the lowest threshold with at least 95% precision
  among its emitted `bug` or `feature` predictions, requiring at least 100
  emitted examples. If none exists, emit none. Report held-out precision and
  coverage using the fixed threshold. This is an advisory threshold, not a
  safety guarantee.

## Metrics and claims

Report accuracy, micro-F1, macro-F1, each-class precision/recall/F1, confusion
matrix, and warm latency per request (including tokenization but excluding model
load). Compare with the publisher's reported FastText and RoBERTa baselines as
**external reference numbers**, not a controlled head-to-head: their training
set and conditions differ. Do not claim state of the art or model-routing
savings from issue-type accuracy.

The dataset's GitHub-derived labels are proxy targets and may be noisy. The
publisher's train/test split is issue-level and may leak repository style and
duplicate text. The eventual product gate needs independently reviewed
Anvilmark tasks and matched fast/strong coding-agent outcomes.

## External transfer check (declared after NLBSE'23 test, before NLBSE'24 data access)

Use the [NLBSE'24 publisher's test file](https://github.com/nlbse2024/issue-report-classification),
repository commit `2927bc67eb42db8affd16eaf3e5a6d74f3063961`,
`data/issues_test.csv`. The three labels are `bug`, `feature`, and `question`;
the publisher states 1,500 balanced test issues from five repositories.

- Reuse the **fixed** NLBSE'23-trained linear and selected MiniLM checkpoints.
  Do not fine-tune, select an epoch, calibrate, or update a threshold from this
  file. A `documentation` output is an error on this three-class set.
- Use the same title + first 2,000 body characters. Report full-set accuracy,
  three-class macro-F1 and per-class metrics; report macro-F1 for each source
  repository and its unweighted mean. Also report bug/feature suggestion
  precision and coverage using the thresholds fixed on NLBSE'23 validation.
- Audit exact normalized text overlap with selected NLBSE'23 training records.
  Report a no-exact-overlap diagnostic with the same predictions.
- The NLBSE'24 competition baseline trained **separate models on its own
  per-repository training splits**, so it is only context, not a controlled
  head-to-head for our zero-shot cross-dataset transfer.
