# Interview Guide

Thirty minutes. Fifteen interviews. The objective is to learn whether a specific, recent, costly event happened — not whether the idea sounds appealing.

## Rules for the interviewer

1. **Do not describe ANVILMARK until minute 22.** Everything before that is contaminated the moment the participant knows what answer would please you.
2. **Ask about the last time, not about usually.** "Usually" produces a reconstructed average. "The last time" produces a story with dates and dollar figures.
3. **Ask them to show you.** A screen-shared PR, invoice graph, incident channel, or dashboard outranks any verbal claim. Note in the record whether anything was actually shown.
4. **Silence is a tool.** After an answer, wait. The second half of the answer is the useful half.
5. **Never say the words "cost optimization," "architecture," "governance," or "conformance."** They prime the participant into a category and produce category-shaped answers.
6. **Write down verbatim quotes**, especially numbers and dates. Paraphrase loses the evidence.
7. **A refusal is a result.** If they will not share telemetry, that is the single most valuable data point available. Get the reason in their own words.

## Leading questions — banned list

Do not ask these, or anything resembling them. Each is included with its neutral replacement.

| Banned                                                         | Why it fails                             | Ask instead                                                         |
| -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| "Would it be useful to know the cost impact before you merge?" | Everyone says yes. Measures politeness.  | "Walk me through the last model or prompt change you shipped."      |
| "Do you worry about LLM costs?"                                | Invites performance of concern.          | "What did you spend on inference last month? How did you find out?" |
| "Would you pay for this?"                                      | Hypothetical purchases are free.         | "What do you currently pay for, in this area?"                      |
| "Is quality regression a problem for you?"                     | Names the problem for them.              | "Tell me about the last time a change didn't do what you expected." |
| "Don't you find it hard to predict cost from a diff?"          | Two leading assumptions in one sentence. | "Before you merged it, what did you think it would cost?"           |
| "How often does this happen?"                                  | Produces a fabricated frequency.         | "When was the most recent time? And before that?"                   |

---

## Script

### 0. Framing — 2 minutes

> Thanks for the time. I'm doing research on how teams running LLMs in production make changes to them. I'm not selling anything — there's no product to sell yet. I mostly want to hear about specific things that have actually happened at your company.
>
> Is it all right if I take notes? Nothing is shared outside this research, and I won't use your company name in anything without asking first.
>
> One thing that would help enormously: if we get to something concrete — a PR, an incident, a graph — I'd love to actually look at it with you rather than just hear about it.

_Sets the show-me expectation up front, so the later request is not a surprise._

### 1. Context — 3 minutes

1. "What does your product do, and where does the LLM sit in it?"
2. "How many engineers touch that code?"
3. "How long has it been in production?"

_Screening confirmation only. Do not spend more than 3 minutes._

### 2. The last change — 8 minutes

**This is the most important section. Protect its time budget.**

4. "Walk me through the last time you changed a model, a prompt, or how requests get routed. What was the change?"
5. "What made you make it then?"
6. "Before you merged it — what did you expect it to do to cost? To quality?"
   - Follow up: "How did you arrive at that expectation?"
   - Follow up: "Did you write that down anywhere, or say it to anyone?"
7. "What actually happened?"
   - Follow up: "When did you find out? How?"
   - Follow up: "How long between merging and knowing?"
8. **"Can you show me that PR?"**
   - If yes: note the diff shape, the review comments, and whether cost or quality was discussed at all in review.
   - If no: "Can you describe what the diff touched?"

**Listen for, and record verbatim:** the gap between expectation and outcome; the detection latency; whether anyone objected during review; whether it was rolled back.

### 3. The surprise — 6 minutes

9. "Tell me about the last time an AI change did something you didn't expect — cost, quality, latency, anything."
   - If they cannot name one: "What about a time someone else on the team shipped something surprising?"
   - If still nothing: **this is a weak-pain signal.** Record it and move on. Do not fish.
10. "What did that cost you — in money, in time, or in anything else?"
11. "What did you change afterward, if anything? Process, tooling, rules?"
12. "Has anyone here become reluctant to touch the model configuration?"
    - _Neutral phrasing of the freeze trigger. Do not say "freeze."_

### 4. Current practice — 5 minutes

13. "What's in your CI today for the AI parts of the codebase?"
14. "If I asked what you spent on inference last month, how would you find out, and how long would it take?"
15. "Do you have evals? What do they run against — and where did that data come from?"
    - _Critical follow-up:_ "How close is that eval data to what real users actually send?"
16. "What do you pay for today in this area?"
    - _Establishes a real price anchor rather than a hypothetical one._

### 5. Data access — 4 minutes

**Ask this before revealing the concept. An access answer given after a pitch is worth much less.**

17. "Where does per-call data live today — tokens, latency, model, that sort of thing? What system?"
18. "If someone needed 30 days of that exported, who would have to say yes, and roughly how long would that take?"
19. "Separately — the actual request and response content. Is that stored? Who could approve someone looking at a sample of it?"
20. "Would the answer change if the analysis ran inside your own CI, and no request content ever left your infrastructure?"
    - **Record both answers separately.** The delta between them is the value of the in-CI design and directly informs [`telemetry-requirements.md`](telemetry-requirements.md).
21. "Who at the company would need to sign off on something like that — security, legal, a customer contract?"
    - _This identifies the security stakeholder. Get a name or a role._

### 6. The concept — 4 minutes

Now, and only now, describe it. Once, plainly, without embellishment:

> Here's what I'm considering building. When you open a PR that touches an LLM call, it takes a sample of your own recorded production inputs for that exact call site, runs them through both the old and new configuration, and posts a comment estimating what the change does to your monthly cost and to output quality — with an honest error range, because it's a sample. Then after you deploy, it measures what actually happened and posts a scorecard showing how close the prediction was.
>
> Right now this doesn't exist. There's a scaffold and a lot of analysis. I'm trying to work out whether it's worth building.

22. "What's your first reaction?"
23. "What would make that untrustworthy to you?"
    - _Objections are more informative than enthusiasm. Let them run._
24. "Is there anything you already use that does this?"
    - **Critical for the absorption test.** If they name Braintrust, probe hard: "Does it tell you the cost impact at your actual volume, or the quality on a test set?"
25. "What would have to be true for you to let a check like that block a merge?"

### 7. Close — 2 minutes

26. "Who else should I talk to?"
27. If the interview scored 6 or higher: "Would you be open to me doing this for real on one of your PRs? I'd need a telemetry export. I'd pay attention to whatever constraints you have on the data."
28. "Anything I should have asked and didn't?"

---

## Scoring rubric

Score immediately after the call, before the next one. Maximum 20.

| #   | Dimension                   | 0                 | 1                               | 2                                      | 3                                                               |
| --- | --------------------------- | ----------------- | ------------------------------- | -------------------------------------- | --------------------------------------------------------------- |
| 1   | **Recency of pain**         | No incident ever  | Over 12 months ago              | 3–12 months ago                        | Within 90 days                                                  |
| 2   | **Concreteness**            | Generalities only | A story, no numbers             | Numbers, from memory                   | Showed a PR, invoice, or incident on screen                     |
| 3   | **Cost of the incident**    | None              | Annoyance                       | Named a figure or hours lost           | Material: rollback, customer impact, or a freeze                |
| 4   | **Detection latency**       | Caught pre-merge  | Caught same day                 | Caught within a week                   | Caught by the invoice or by a customer                          |
| 5   | **Data access realism**     | Refused outright  | "Would need a lot of approvals" | Plausible, named a person              | Offered, or said yes within days; in-CI resolves any hesitation |
| 6   | **Existing spend anchor**   | Pays for nothing  | Free tools only                 | Pays for observability or evals        | Pays and named a figure                                         |
| 7   | **Reaction to the concept** | Polite interest   | Interested, no specifics        | Named a specific PR they'd apply it to | Asked when they could have it, or named a blocked decision      |

**Bands:**

| Score | Reading                         | Action                                                                    |
| ----- | ------------------------------- | ------------------------------------------------------------------------- |
| 16–20 | Strong pain, accessible data    | Request telemetry on Day 5. Send the design-partner offer.                |
| 11–15 | Real pain, friction somewhere   | Request telemetry. Note the specific friction in the assumption register. |
| 6–10  | Weak pain, or data inaccessible | No telemetry request. Counts toward the 15 but not toward the pain count. |
| 0–5   | Not this problem                | Record why. Check whether the ICP screening should have caught it.        |

**Kill criterion 1** counts interviews scoring **3 on dimension 1** (incident within 90 days). Fewer than 5 of 15 triggers the kill.

## Signal library

### Strong pain — quote it verbatim

- "We rolled it back."
- "We found out from the bill."
- "Nobody wants to touch that config now."
- "I spent a week working out which change caused it."
- "The CEO asked me why the number went up."
- "We have a migration we keep putting off because we don't know what it'll do."
- "We shipped it, and support noticed before we did."
- **The strongest possible signal:** "I would have merged that."

### Weak pain

- "It's on our list."
- "We should probably look at that."
- "It's not really a problem yet, but as we scale…"
- "Costs are fine, we're mostly on the free tier."
- "We'd have to see it."
- Enthusiasm about the concept combined with no example from the last 12 months.

### False positives — enthusiasm that is not pain

Watch for these specifically. Each produces a high concept-reaction score with a low pain score, and each will mislead the sprint if not flagged.

| Pattern                   | What it looks like                                                                 | Why it is not pain                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **The tourist**           | Loves the idea, has no production traffic, wants to talk about architecture.       | Enjoys the topic. Will never buy. Common among fellow founders.                   |
| **The vendor-curious**    | Detailed questions about the method, none about their own situation.               | Competitive research or intellectual interest.                                    |
| **The polite founder**    | Warm, agreeable, gives no specifics, offers introductions readily.                 | Being kind. Score dimension 2 at 0 and treat the introductions as the real value. |
| **The someday-migration** | "We'll definitely need this when we move off GPT."                                 | Future pain is not pain. Only score it if the migration has a date.               |
| **The proxy complainer**  | Complains at length about a cost problem in a system they don't own.               | No authority over the merge, the bill, or the data.                               |
| **The eval enthusiast**   | Wants to discuss eval methodology at length; has no cost dimension to the problem. | Braintrust and promptfoo already serve them. Note as an absorption data point.    |

**Rule:** if dimension 1 scores 0–1, no amount of enthusiasm on dimension 7 makes the interview count as pain. Record the mismatch explicitly.

## Record template

One per interview. Store alongside this document or in the sprint tracker.

```text
Company / role / date:
Screening result (from ideal-customer-profile.md):
Trigger observed (1–5, or none):
Inference spend (stated / estimated):
Telemetry system(s):

THE LAST CHANGE
  What changed:
  Expectation before merge:
  Actual outcome:
  Detection latency:
  Shown on screen? (Y/N — what):

THE SURPRISE
  Incident, with date:
  Cost of it:
  What changed afterward:
  Freeze present? (Y/N):

DATA ACCESS
  Telemetry: who approves / how long:
  Request content: who approves / how long:
  Answer change under in-CI execution? (Y/N):
  Security stakeholder (name or role):

CONCEPT
  First reaction (verbatim):
  Trust objections:
  Named an existing tool that does this? (which):
  Would let it block a merge? Under what condition:

SCORES  1:_ 2:_ 3:_ 4:_ 5:_ 6:_ 7:_   TOTAL: __/20
FALSE-POSITIVE PATTERN (if any):
VERBATIM QUOTES:
NEXT STEP:
```
