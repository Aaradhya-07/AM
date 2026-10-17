# Development-model pilot observation — 2026-10-16

The first `anvilmark development` slice connects one architecture summary and
coding task to a restriction-aware option comparison, exact plan approval,
Codex CLI run metadata, Git change, named checks, exact run review, and a local
report. The record is a sidecar under `.anvilmark/development/`. It has not
migrated the accepted application-model contract.

## Verification

- The CLI TypeScript build, focused tests, lint, formatting, and diff checks
  passed after implementation.
- A synthetic end-to-end Git repository exercised plan → typed approval →
  fake agent event → changed file → passing check → typed review. The report
  showed `accepted_current`, then `accepted_stale` after a code edit.
- One real Codex CLI run on a separate small Git task produced nine structured
  events, 47,743 reported input tokens and 261 output tokens. It changed one
  file and the named check passed. The event stream did not report a served
  model, so Anvilmark recorded `configured_only`. Subscription cash cost is
  unknown. The architecture plan had not received a prior human approval, so
  this run is explicitly `missing_or_stale` at start and cannot be accepted
  retroactively.
- A first sandboxed Codex CLI attempt could not initialize its local state;
  the pilot recorded its nonzero agent exit, zero model usage, no changed paths,
  and failed check. The real run succeeded after the local Codex state was
  accessible.
- A full CLI suite attempt in the restricted workspace reported 203 passing,
  37 failing, and 25 skipped tests. Representative failures were loopback
  `listen EPERM` and built-binary subprocesses returning empty captured output.
  It is not a clean regression result. The focused development tests and the
  isolated end-to-end checks above passed.

These checks establish the mechanics of one local path. They do not establish
that Anvilmark chooses a better model, reduces money spent, or works across
multiple agents and projects. The example's usage estimates are declarations.
The next product validation requires a real user-approved architecture task,
comparable model runs, observed billing terms, and review/rework outcomes.
