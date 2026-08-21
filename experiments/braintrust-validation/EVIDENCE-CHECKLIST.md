# Evidence Checklist

Every conclusion that updates [`../../docs/validation/competitor-validation-matrix.md`](../../docs/validation/competitor-validation-matrix.md) needs a corresponding artifact here.

**Rule: a written assertion without a screenshot does not convert a `?` or `d` into a confirmed mark.** This exists so the differentiation claim rests on evidence a sceptic could check.

Store artifacts outside this repository, in a trial folder. **None will contain customer data — the experiment uses only synthetic input.**

---

## Phase 0 — offline

- [ ] Terminal output of `generate-datasets.mjs` showing the skewed class distribution
- [ ] Checksums proving determinism across two runs
- [ ] Checksums proving `s1-tickets.jsonl` and `s1-repeat.jsonl` are identical

## Phase A — logs to dataset

- [ ] Log view showing **per-span token counts and cost**
- [ ] Logs → dataset conversion dialog
- [ ] Resulting dataset view — **does `frequency_weight` survive the conversion?**
- [ ] Written note: was conversion possible at all, and in how many clicks?

## Phase B — experiment comparison _(decisive)_

- [ ] **Full comparison view, every column visible** — the single most important artifact
- [ ] Any cost or token display found in comparison, or a note that none exists
- [ ] Row-level detail view, showing whether per-input pairing is available
- [ ] Any weighting or filtering control found in the comparison UI
- [ ] Written answers to Phase B questions 1–4

## Phase C — PR surface

- [ ] **PR comment, Scenario 1** (model swap)
- [ ] **PR comment, Scenario 2** (prompt expansion)
- [ ] Workflow YAML actually used, plus the run log
- [ ] Verbatim list of every field in the comment
- [ ] Explicit yes/no: does any cost figure appear?

## Phase D — noise floor

- [ ] **Old-vs-old comparison, Scenario 1**
- [ ] **Old-vs-old comparison, Scenario 2** (higher variance)
- [ ] Written note: is run-to-run variation labelled as improvements/regressions?
- [ ] Written note: any statistical treatment or noise indication?

## Phase E — cost surfaces

- [ ] Every cost dashboard screen
- [ ] Any invoice-comparison feature found, or a note that none exists
- [ ] Any forward-looking cost figure found, or a note that none exists
- [ ] Any post-deploy comparison feature found, or a note that none exists

---

## Test verdicts

Fill in only from captured evidence. **`d` (absent from documentation) is not a verdict — it must become a hands-on observation.**

| Test | Question                            | Verdict | Evidence | Wedge |
| :--: | ----------------------------------- | :-----: | -------- | :---: |
|  T1  | Cost in experiment comparison?      |         |          |       |
|  T2  | Cost in PR comment?                 |         |          |       |
|  T3  | Volume/monthly projection anywhere? |         |          |       |
|  T4  | Frequency-weighted datasets?        |         |          |       |
|  T5  | Predicted-vs-actual scoring?        |         |          |       |
|  T6  | Invoice reconciliation?             |         |          |       |
|  T7  | Noise floor modelled?               |         |          |       |

**Wedge column:** `survives` if the capability is absent; `occupied` if present.

### Overall

| Outcome                 | Action                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| T2, T3, T5 all survive  | **Continue.** Narrow the claim to cost + calibration, excluding replay and quality. |
| T2 or T3 occupied       | **Stop and reassess** — C5 was the primary commercial hook.                         |
| T5 occupied             | **Stop and reassess** — C8 was the defensibility argument.                          |
| T4 and T7 occupied only | Continue, defensibility revised down again.                                         |

---

## Recording discipline

1. Timestamp every artifact.
2. Capture the **whole** screen, not a crop. A cropped screenshot cannot prove a field's absence — and absence is what most of these tests measure.
3. Record the Braintrust UI version or date, since surfaces change.
4. **Record disconfirming evidence first.** Anything suggesting Braintrust already occupies the wedge goes at the top of the write-up, not in a footnote.
5. Record actual provider spend against the cap.
6. When updating the matrix, cite the artifact filename for each mark.
