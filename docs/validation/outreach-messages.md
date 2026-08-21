# Outreach Messages — Drafts

> **Status: drafts only. Nothing here has been sent. No company or individual has been contacted.**
> Per the standing instruction for this phase, no outreach may be sent without explicit approval.

## Honesty constraints

These are binding on every message in this document and on any variation of them.

**ANVILMARK today is:** a contract-first scaffold with no working recommendation engine, plus a research archive and this validation package.

**ANVILMARK today is not:** a product, a beta, a working tool, a service anyone uses, or something with customers.

Therefore, every message must:

1. **Say it does not exist yet.** Never imply a working product, a waitlist, an early-access program, or existing users.
2. **Say this is research.** The ask is time and, later, a paid design partnership — not a purchase.
3. **Avoid fabricated social proof.** No "teams like yours," no "we've seen," no invented customer counts, no borrowed logos.
4. **Avoid invented statistics.** No "teams waste 40% of their inference spend." We have measured nothing.
5. **Make the ask small and specific.** 30 minutes, one call, no obligation.
6. **Be answerable with a no.** An easy no produces a faster, more honest yes.
7. **Never promise savings.** We cannot predict anything yet. That is the entire point of the sprint.

A message that would embarrass us if forwarded to a competitor, or if quoted back after a failed sprint, does not go out.

---

## 1. Founder to founder — cold

Subject: `research question about your LLM costs`

> Hi {{first_name}},
>
> I'm working on a research question and you're one of the few people who'd have a real answer.
>
> When your team changes a model, a prompt, or a routing rule — do you know what it'll do to your bill and to output quality before you merge it, or do you find out afterward?
>
> I'm interviewing 15 teams running LLMs in production about how they actually make those calls. I'm considering building something in the area, but there's nothing to show yet — this is genuinely research, not a demo in disguise.
>
> 30 minutes, and I'll share what I learn across all 15 conversations, anonymized.
>
> If it's not relevant, no reply needed at all.
>
> {{sender}}

_Length: ~110 words. One question, one ask, one exit._

**Do not add:** a link to a landing page, a calendar embed above the fold, a product name in the subject line, or any claim about what other teams told us.

---

## 2. Technical lead / staff engineer — cold

Subject: `how do you size an LLM change before merging it?`

> Hi {{first_name}},
>
> Direct question, since you own this: when a PR changes a model or a prompt, how do you work out what it does to cost and quality before it goes in?
>
> Every team I've asked so far describes some version of "we estimate, we ship, we watch the dashboard." I'd like to understand what you actually do — including if the answer is "we don't, we just ship it."
>
> I'm doing 15 of these interviews. I'm thinking about building a tool that replays your own recorded production inputs through both versions of a changed call site and estimates the delta before merge — but it doesn't exist, and I want to know whether it should before I write any of it.
>
> 30 minutes? Happy to go deep on methodology if that's more interesting than the product question.
>
> {{sender}}

_Note: "every team I've asked so far describes…" is only usable **after** interviews have actually produced that pattern. Until then, delete that sentence. Do not assert a pattern we have not observed._

---

## 3. Warm-introduction request

Sent to someone who can introduce us — not to the target.

Subject: `intro request — teams running LLMs in production`

> Hi {{first_name}},
>
> A favour, and an easy no.
>
> I'm interviewing 15 engineering teams that run LLMs in production about how they decide whether a model or prompt change is safe to merge — cost and quality both. Pure research; I'm trying to work out whether something is worth building, and right now there's nothing but analysis.
>
> The teams I'm looking for: 5–30 engineers, LLM on the critical path, spending enough per month on inference that someone has noticed.
>
> Does anyone come to mind? Happy to send a forwardable paragraph so you don't have to write anything.
>
> And if nobody springs to mind, genuinely no problem.
>
> {{sender}}

### Forwardable paragraph

Keep separate so the introducer can paste it without editing.

> {{sender}} is interviewing 15 teams running LLMs in production about how they decide whether a model or prompt change is safe to merge — what it does to cost, what it does to quality, and how they find out. It's research at this stage; they're trying to work out whether to build something. 30 minutes, no pitch, and they share the anonymized findings with everyone who takes part.

---

## 4. Follow-up — after no reply

Send **once**, 5–7 days after the original. Never a third time.

Subject: `re: {{original_subject}}`

> Hi {{first_name}} — following up once, then I'll leave you alone.
>
> Still looking for teams to talk to about how you size an LLM change before merging. 30 minutes, no pitch.
>
> If the timing's wrong or it's just not your problem, a one-word reply is genuinely useful — it tells me something either way.
>
> {{sender}}

_The "one-word reply is useful" line is true and produces data. A no is a data point for kill criterion 1._

---

## 5. Follow-up — after a positive interview

Sent within 24 hours of an interview scoring 11 or higher. This is the telemetry ask, and the sprint turns on it.

Subject: `following up — the {{specific_thing_they_mentioned}} PR`

> Hi {{first_name}},
>
> Thanks — genuinely useful. The part about {{specific_detail_from_interview}} was the clearest version of that problem anyone's described to me.
>
> You mentioned {{the PR or incident}}. I'd like to try doing the analysis on it for real, so I can find out whether the method actually works rather than assuming it does.
>
> What I'd need:
>
> - roughly 30 days of your existing per-call telemetry (tokens, model, timestamps, latency, retries — whatever {{their_system}} already records);
> - one month's total from your provider invoice, so I can check my reconstruction against reality;
> - a sample of real recorded inputs for the one call site the PR touched.
>
> On that last one: my default is that request content never leaves your infrastructure. I'd run the replay inside your CI, or give you a script you run yourself and send me only the aggregate numbers. If that's still a problem, tell me and I'll work with whatever constraint you have — or we skip that part and I'll be explicit in the report about what I couldn't measure.
>
> In return you get a written analysis of that PR: what it did to cost at your actual volume, what it did to quality, with an honest error range and a clear statement of anything I couldn't establish. Free, and I'll be straightforward if the answer is "not enough evidence."
>
> Worth a try?
>
> {{sender}}

**Note on the sequencing:** privacy is addressed before it is objected to, and the possibility of an inconclusive result is stated up front. Both are deliberate. A report that has to admit insufficient evidence is a success for the sprint; promising a definite answer and then retracting it is not.

---

## 6. Follow-up — after a low-scoring interview

Sent within 48 hours to interviews scoring 10 or below. No telemetry ask.

Subject: `thanks — and one ask`

> Hi {{first_name}},
>
> Thanks for the time. Useful to hear that this isn't a live problem for you — that's as informative as the opposite answer, and I'd rather find out now.
>
> One ask: if you know a team where it _is_ live — where someone's been surprised by an LLM bill or had a quality regression they didn't catch — I'd appreciate an introduction.
>
> I'll send the anonymized findings across all 15 conversations when I'm done, either way.
>
> {{sender}}

_Sending the promised findings is an obligation. If the sprint produces findings, they get sent._

---

## Channel notes

| Channel           | Use                                            | Caution                                                                        |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Warm introduction | **Primary.** Highest response, fastest access. | Costs the introducer's credibility. Do not waste on poorly screened targets.   |
| Direct email      | Secondary, for well-screened targets.          | Screen against the ICP first. Volume without screening corrupts the sample.    |
| LinkedIn / X DM   | Tertiary.                                      | Compress to under 60 words; the founder message does not survive the format.   |
| Community spaces  | Opportunistic.                                 | Read the rules. An unsolicited pitch in a community is worse than no outreach. |
| Public post       | **Not for this sprint.**                       | Produces self-selected tourists, exactly the false-positive pattern to avoid.  |

---

## Customized drafts — top five prospects

> **Not sent. Nothing below has been transmitted to any company or individual.**

Prospects ranked in [`recruiting-pipeline.md`](recruiting-pipeline.md) §1. Customization is drawn **only from publicly stated product descriptions**, cited in the pipeline document.

### Honesty constraints, restated for these specifically

Customization tempts exaggeration. These drafts therefore:

- reference **only** what the company says publicly about its own product;
- **assert nothing** about their spend, stack, team size, or incidents — every such reference is phrased as a question;
- never imply prior research beyond reading their website;
- never claim ANVILMARK works.

**If a company's public description has changed since August 13, 2026, rewrite the opening rather than sending a stale reference.**

---

### 1 · Avoca — voice/LLM agents for home-service businesses

**Route:** YC network → warm introduction. **Role:** CTO or founding engineer.

> Hi {{first_name}},
>
> You're running voice agents in production for service businesses, which means you're making a lot of model calls per conversation — and I'm curious how you handle changing them.
>
> Specifically: when someone opens a PR that swaps a model or edits a prompt, do you know what it'll do to your bill and to output quality before it merges? Or do you find out afterward?
>
> I'm interviewing 15 teams running LLMs in production on exactly this. Research, not a pitch — there's nothing built yet beyond analysis, and I'd rather find out whether it's worth building than assume.
>
> 30 minutes? And if it's not your problem, saying so is genuinely useful to me.
>
> {{sender}}

_Hook: multi-turn voice = high per-conversation token cost. Stated as a question about their handling, not an assertion about their bill._

---

### 2 · Blossom — AI copilots and agents for psychiatry

**Route:** Healthcare-AI or investor introduction. **Role:** CTO.

> Hi {{first_name}},
>
> Clinical AI has a property most LLM products don't: a quality regression isn't a metrics problem, it's a patient-facing one. So I'm curious how you gate changes.
>
> When someone changes a model or a prompt, what has to happen before it merges? And how would you know if a change made output subtly worse rather than obviously broken?
>
> I'm interviewing 15 teams running LLMs in production about how they make that call. It's research — I'm working out whether to build something and there's nothing to demo.
>
> I'd also want to understand your constraints around clinical data, since I'd guess they shape a lot of this. 30 minutes?
>
> {{sender}}

_Hook: their real stakes, stated as theirs. Raises the PHI constraint up front — signals seriousness and surfaces the blocker in the first call rather than after a verbal yes._

---

### 3 · Rulebase — AI coworkers reviewing bank and fintech customer interactions

**Route:** YC network → warm introduction. **Role:** CTO or founder.

> Hi {{first_name}},
>
> If you're reviewing calls, chats and emails in real time for compliance, you're running model calls at roughly the volume of your customers' entire support traffic. That's a cost profile most teams never hit.
>
> Question I'm asking 15 teams: when you change a model or prompt, do you know what it does to your bill and to detection quality before you merge — or after?
>
> Compliance is interesting to me because you probably have something most teams don't: a real ground-truth signal for whether output was right.
>
> This is research, not a pitch. Nothing's built. 30 minutes?
>
> {{sender}}

_Hook: volume follows from their own description. The ground-truth observation tests assumption A10 and shows domain understanding._

---

### 4 · Amigo — unified clinical workflow data foundation

**Route:** Healthcare-AI or investor introduction. **Role:** VP Engineering.

> Hi {{first_name}},
>
> You're building across clinical workflows, which I'd guess means several distinct model call sites with quite different cost and accuracy requirements.
>
> What I'm trying to understand across 15 teams: when a change touches one of those call sites, how do you work out what it does to cost and quality before merging? And is that different for the workflows where accuracy matters most?
>
> Research rather than a pitch — I'm deciding whether something's worth building and there's nothing to show yet.
>
> 30 minutes, and happy to work around whatever constraints you have on discussing clinical data.
>
> {{sender}}

_Hook: multiple call sites with differing requirements — the multi-call-site mapping question in [`experiment-protocol.md`](experiment-protocol.md) §4._

---

### 5 · Yuma AI — AI customer support automation for e-commerce

**Route:** Cold, or e-commerce network. **Role:** CTO or founder.
**Verify first:** the funding reference in the pipeline is from 2024. Confirm the company and product are current before sending.

> Hi {{first_name}},
>
> Support automation is the workload where I'd expect model-change decisions to bite hardest — high ticket volume, and quality problems show up as angry merchants rather than as a dashboard metric.
>
> So: when you change the model or the prompt behind ticket handling, do you know what it does to cost and to resolution quality before it ships?
>
> I'm interviewing 15 teams on this. It's research — nothing is built, and I'm trying to establish whether it should be.
>
> 30 minutes? If support automation isn't where your model spend actually sits, that's useful for me to hear too.
>
> {{sender}}

_Hook: quality failures surface through customers, not metrics — the "caught by a customer" signal in the interview guide's strong-pain list. Last line invites correction, which produces better information than agreement._

---

### Warm-introduction requests for these five

Send to the **introducer**, not the prospect. Use with the forwardable paragraph in message 3 above.

> Hi {{first_name}},
>
> Easy no, if it is one.
>
> I'm interviewing 15 engineering teams running LLMs in production about how they decide whether a model or prompt change is safe to merge — cost and quality both. Pure research; I'm working out whether something's worth building.
>
> You're connected to {{company}} — would you be willing to introduce me to whoever owns their AI stack? Happy to send a forwardable paragraph.
>
> {{sender}}

**Restraint:** ask for **one** introduction per introducer in the first request. A list of five reads as a favour with a bill attached and lowers the response rate on all of them.

---

## Day 1 outreach checklist

Sequenced. Warm introductions go first because they have the longest return time and the highest conversion.

### Before sending anything

- [ ] Verify each of the five companies still exists, and the product still matches the pipeline description. **Tier C entries and the 2024-sourced Yuma reference especially.**
- [ ] Rewrite any opening line whose public reference has gone stale.
- [ ] Confirm you can name a plausible introducer for prospects 1–4.
- [ ] Re-read the honesty constraints at the top of this file.
- [ ] Confirm the sending address and that a reply reaches you.

### Send — in this order

- [ ] **Warm-introduction requests for prospects 1, 3** (YC network — likely the same introducer pool; ask for one each).
- [ ] **Warm-introduction requests for prospects 2, 4** (healthcare network).
- [ ] **Direct message to prospect 5** (Yuma) — cold, so only after verification.
- [ ] **Generic introduction request** (message 3) to 3–5 further contacts, without naming a company, to widen the funnel beyond the top five.

### Do not

- [ ] Do **not** send the technical-lead message with the "every team I've asked so far…" line — no interviews have happened, so that sentence is not yet true. Delete it.
- [ ] Do **not** send more than one message per prospect on Day 1.
- [ ] Do **not** post publicly about the research.
- [ ] Do **not** mention the $1,000 design-partner offer in first contact. It comes after an interview scoring 11 or above.

### Record

- [ ] Log every send in the tracking fields below and in [`validation-scorecard.md`](validation-scorecard.md) §1.
- [ ] Diarize follow-ups for 5–7 days out (message 4, once only).
- [ ] Note which introducers responded — that is your Day 2 routing information.

## Tracking

Per contact, record: name, company, channel, date sent, follow-up date, reply (yes/no/decline), interview booked, interview score, telemetry requested, telemetry granted, turnaround in business days. Feed into [`validation-scorecard.md`](validation-scorecard.md).
