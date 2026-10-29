# Label-aware reranker: predeclared evaluation

Recorded 2026-10-17 before training or inspecting HWU evaluation scores.

## Fixed training and selection

- Train a MiniLM pair encoder on BANKING77's 50 training labels and the English
  MASSIVE training split. Each message has its true label and three negative
  labels: two hard negatives from frozen MiniLM retrieval and one sampled
  negative. Optimize a four-way cross-entropy loss.
- The retrieval stage is **frozen raw-input MiniLM**. It shortlists eight labels.
  The pair encoder then scores each message with each shortlisted label.
- Select checkpoint epoch and retrieval/reranker rank-fusion weight from
  `0, 0.25, 0.5, 0.75, 1` using the mean top-one accuracy on BANKING77's
  unseen-label validation group and the official MASSIVE validation split.
  Break ties in favor of less reranking. Do not use CLINC150 or HWU scores to
  select or retrain the model.
- Report retrieval top-one and top-eight recall, pure reranker top-one, and
  selected fusion top-one, macro-F1, paired difference, and inference time.

## New held-out domain

- Source: the [original HWU home-domain annotated data](https://github.com/xliuhw/NLU-Evaluation-Data), commit
  `f6071b496b17d71e6eb43f543af0707f4ff30557`, file
  `AnnotatedData/NLU-Data-Home-Domain-Annotated-All.csv`, SHA-256
  `5f6dbf6d38fc111217924945ac59c554e0b926d5aa836ecdd0d089d2ca48e1d9`.
  The original repository states CC-BY-4.0.
- Parse the semicolon-separated file. Use the `answer` text and
  `scenario` + `intent` as the label, excluding blank messages and records whose
  status starts with `IRR`. Collapse whitespace and lowercase for duplicate
  and cross-dataset overlap audits. Exclude texts assigned to multiple labels.
- For an affordable fixed test, choose up to 30 unique messages per label by
  ascending SHA-256 of `label + NUL + normalized message`; use all if fewer.
  Candidate choices are the full set of surviving `scenario` + `intent`
  labels, displayed to the model as plain words.
- Count and exclude exact matches with either training corpus from the primary
  accuracy comparison. Report the number removed. If these filters yield a
  different number of labels than the commonly used 64-class HWU subset,
  describe this as an **original-source HWU evaluation**, not the canonical
  HWU64 benchmark.
- Run this test only after checkpoint and fusion weight are fixed. Then treat
  it as spent. A negative result is still a result; do not tune against it.

This benchmark measures unseen-domain intent classification with caller-supplied
labels. It does not establish parity with Jev's broader question types, speed,
pricing, or calibrated probabilities.

## Supplemental non-intent check (declared before scoring)

- Use Google's [GoEmotions](https://github.com/google-research/google-research/tree/master/goemotions)
  official test split and label files at repository commit
  `3ef52111c1fabc301880818f5a547570e926a76b`. The source files and
  SHA-256 values are: `test.tsv`
  `0587b2dd8b27b97352adbfc3fb083d46005c8946657fdc2b1ca8b1cc7f1f8be4`,
  `emotions.txt`
  `45c3ef86782d2a4d7fedcd6d8c111aa0d0e94720689bd164fac94fefb4495a89`,
  and `sentiment_mapping.json`
  `801f6f028082141bd38541a4b14d65b33bdc55d29c7b2aaa029fefecf206f76b`.
  The repository states that its datasets use CC-BY-4.0.
- Restrict to test examples with exactly one emotion label. For 28-way emotion
  choice, select up to 50 unique examples per emotion by ascending SHA-256 of
  `label + NUL + normalized message`. Give all 28 emotion names as choices.
- For binary sentiment, use the publisher's positive/negative emotion mapping;
  omit ambiguous and neutral labels. Select up to 1,000 unique examples per
  side by the same deterministic hash rule. Give the two labels exactly as
  `positive` and `negative`.
- Remove exact text matches with the training corpora from each comparison and
  report the counts. Keep the checkpoint and fusion weight selected above.
  Report retrieval, pure reranker, selected fusion, paired accuracy changes,
  and shortlist recall. Do not tune based on these results.

The binary labels are a coarse collapse of emotion annotations, not independently
annotated sentiment. This test can reveal limits in transferring an intent-trained
model to new question types; it is not a substitute for direct binary or ordered
score training and evaluation.

## Supplemental ordered-score check (declared before scoring)

- Use the [publisher's Query-wellformedness test
  split](https://github.com/google-research-datasets/query-wellformedness),
  commit `fb69c21416195cddc797277ea9e4d393226571d2`, file `test.tsv`,
  SHA-256 `978574b96a37587845fd25e1cabc992a2d6f1bcab57750d1d04b60e2757a0ba2`.
  The publisher states CC BY-SA 4.0. Its 3,850 test queries have the average
  of five human yes/no well-formedness ratings, so scores are 0, 0.2, ..., 1.
- Use the full official test split after removing exact text matches with
  either training corpus. Do not use the dataset's training or development
  split for this fixed-checkpoint check.
- Give six choices, in order: `0/5: not a well-formed natural language
  question`, `1/5: barely a well-formed natural language question`, `2/5:
  poorly formed natural language question`, `3/5: moderately well-formed
  natural language question`, `4/5: mostly well-formed natural language
  question`, and `5/5: fully well-formed natural language question`.
  Convert the chosen index to `index / 5`.
- Report exact score accuracy and mean absolute error for frozen retrieval,
  pure reranking, and the previously selected rank fusion. Also report a
  constant 0.5 score baseline, top-six recall, and paired confidence interval
  for MAE change. Do not tune checkpoint, weight, or labels from the result.

This tests whether the current intent-trained model can order a specific
well-formedness criterion. It does not validate arbitrary Jev Score questions.

**Pre-inference format amendment.** The first evaluation attempt stopped during
source validation, before loading or scoring the model: 13 of the 3,850 official
test values are fractions outside the 0.2 grid (such as 0.8333), despite the
dataset description. Keep all values. Measure MAE against each original
fractional rating. For exact six-choice accuracy only, map the rating to the
nearest 0.2 using `floor(5 * score + 0.5) / 5`. Keep the constant 0.5 MAE
baseline. No model choices or output scores were inspected before this change.
