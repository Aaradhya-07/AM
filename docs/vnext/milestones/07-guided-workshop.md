# Guided Atlas workshop

This is the operator-facing training workflow. Preparation and checks use the
real CLI; the application, declarations and model identity are synthetic test
inputs. It complements the [unattended fixture replay](07-atlas-walkthrough.md).
It does not record approval for a real project or demonstrate actual agent use.

## Prepare and review

Follow the [quickstart](../../../QUICKSTART.md) for Node 24, pinned pnpm and
`node scripts/setup.mjs`. From the checkout, select a new destination:

```sh
export ANVILMARK_WORKSHOP="$PWD/../atlas-training"
pnpm run workshop prepare "$ANVILMARK_WORKSHOP"
pnpm run workshop instructions "$ANVILMARK_WORKSHOP"
```

The runner:

1. Imports the Atlas draft with `app` as its declared repository. There are no
   decisions or approvals in the seed.
2. Records the training assumptions as an unresolved question.
3. Shows the outbound proposal preview, exports a handoff request, imports the
   committed offline response and retains its provenance. Generated inferences
   remain T0. No agent/provider is invoked.
4. Declares the training remote candidate's provider, synthetic region and
   pinned literal model reference, then compares classification candidates.
5. Drafts and proposes `decision.classification`, listing unresolved privacy,
   availability and quality constraints. It prints the exact review and hash.
6. Writes scanner declarations and synthetic source with two deliberate
   violations: an unapproved model and raw ticket data sent to the remote sink.

Preparation refuses any existing destination, including an empty directory.
If interrupted, the partially prepared directory stays available for inspection;
use a fresh destination after fixing the reported error. Nothing in an existing
project is reset or silently replaced.

`NEXT-STEPS.txt` contains commands with the actual checkout/project paths,
including quoting for spaces. After moving either directory, rerun `instructions`
from the current checkout to obtain the new commands.

## Make the decision yourself

Run the printed `status`, `compare` and `review` commands. Inspect the intent,
workload, hard constraints, assumptions, alternatives, evidence tiers and gaps.
You can use the regular CLI's edit commands before proposing/reviewing again.
The training model/region are declared values; no price, benchmark or provider
availability has been verified.

If you accept the exact training decision, run the printed `approve` command
in an interactive terminal and enter the requested hash prefix. Enter an empty
answer to decline. There is no approval bypass in the workshop. An interactive
terminal reduces accidents but is not authentication: an unrestricted process
can emulate it. Automated test approvals are explicitly labeled simulations.

The runner's `check` requires the approval to be current. An earlier approval
that no longer covers the selected candidate is refused, preserving existing
context and report files. It never creates an approval or exception.

## Evaluate source under the same contract

```sh
pnpm run workshop check "$ANVILMARK_WORKSHOP"
```

This generates Mermaid, CALM and agent context, then checks current source. The
initial violation should return exit 1, independent provider/privacy failures,
repository-relative locations and a privacy trace in the local report.

```sh
pnpm run workshop variant "$ANVILMARK_WORKSHOP" corrected
pnpm run workshop check "$ANVILMARK_WORKSHOP"
```

The corrected template uses the declared pinned model and redactor output.
Both rules pass (exit 0) within the supported scope, without changing the
contract. Then demonstrate an analysis gap:

```sh
pnpm run workshop variant "$ANVILMARK_WORKSHOP" ambiguous
pnpm run workshop check "$ANVILMARK_WORKSHOP"
```

Both rules remain unknown (exit 2) for dynamic dispatch. To return to a passing
training source, select `corrected` and check again. Variant switching touches
only the known `app/src/classify.ts` template; it refuses manually modified
content and symlinked workshop paths. Preserve your edits elsewhere before
choosing to restore a template. Other project/source files are not reset.

## Inspect or connect a client

Generated views and the full local conformance report live under `.anvilmark/`.
The instructions print the project MCP command using the committed launcher.
Configure your chosen client using the [MCP guide](../../../packages/mcp/README.md).
The default projection withholds source details from conformance tool responses;
`local-disclosed` deliberately exposes them. Client configuration is not modified
by the workshop, and no agent is started. Claude testing remains deferred.

`conformance --check` tests report freshness, not whether its verdicts pass.
Use a normal `conformance` run as the compliance gate. Source edits and changed
configuration are analyzed again; the stored scan is not trusted as current.

## Evidence and limits

The onboarding integration test runs preparation through built binaries,
confirms zero approvals and no writes on refusal, simulates a terminal approval
in a disposable test project, and exercises fail → pass → unknown with unchanged
contract bytes. It also checks stale approval refusal, manual edit preservation,
symlink refusal, paths containing spaces/quotes and launchers before build.
This is automated workflow evidence; it is not a real human or agent acceptance
record.

See [conformance scope](../../../packages/conformance/README.md) for bounded
call propagation, provider support, declared source/sanitizer assumptions and
runtime limitations. See [local development](../local-development.md) for
optional adapters, troubleshooting and cleanup.
