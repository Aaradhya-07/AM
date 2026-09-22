/**
 * A reading of the durable object itself. Shaped after
 * packages/project-contract; the values are illustrative, not live data.
 */

const SAMPLE = `# .anvilmark/project.yaml
schema_version: 0.1.0-draft.3

constraints:
  - id: privacy.raw_ticket_remote
    domain: privacy
    severity: hard
    operator: must_not_leave
    value: local_trust_boundary

decisions:
  - id: decision.classification.runtime.v1
    status: ratified
    selected_candidate_ref: candidate.classification.local_a
    alternatives: [candidate.classification.remote_b]
    evidence_refs:
      - evidence.llmfit.local_a
      - eval.classification.local_a.v1

conformance_rules:
  - id: rule.raw_ticket_never_remote
    kind: forbid_dataflow
    severity: error
    constraint_ref: privacy.raw_ticket_remote`;

const PAIR = /^(\s*)(- )?([A-Za-z0-9_.]+)(:)(.*)$/;
const ITEM = /^(\s*)(- )(.+)$/;

type Piece = { text: string; className?: string };

function tokenize(line: string): Piece[] {
  if (line.startsWith("#")) return [{ text: line, className: "text-sand/45" }];

  const pair = line.match(PAIR);
  if (pair) {
    const rest = pair[5] ?? "";
    return [
      { text: pair[1] ?? "" },
      ...(pair[2] ? [{ text: pair[2], className: "text-steel" }] : []),
      { text: pair[3] ?? "", className: "text-sand" },
      { text: pair[4] ?? "", className: "text-steel" },
      {
        text: rest,
        // The one gold value on the page: a ratified decision is a human act.
        className: rest.trim() === "ratified" ? "text-gold" : "text-canvas/90",
      },
    ];
  }

  const item = line.match(ITEM);
  if (item) {
    return [
      { text: item[1] ?? "" },
      { text: item[2] ?? "", className: "text-steel" },
      { text: item[3] ?? "", className: "text-canvas/90" },
    ];
  }

  return [{ text: line }];
}

const LINES = SAMPLE.split("\n").map(tokenize);

export function ContractPreview() {
  return (
    <figure className="am-module min-w-0 overflow-hidden bg-ink/70">
      <figcaption className="flex items-center justify-between gap-4 border-b border-line-muted px-4 py-3">
        <span className="am-mono text-sand/80">.anvilmark/project.yaml</span>
        <span className="am-mono text-steel">0.1.0-draft.3</span>
      </figcaption>

      <div className="min-w-0 overflow-x-auto">
        <pre className="min-w-max p-4 font-mono text-[12.5px] leading-[1.75] sm:p-5">
          <code>
            {LINES.map((pieces, index) => (
              <span key={index} className="block">
                {pieces.map((piece, pieceIndex) => (
                  <span key={pieceIndex} className={piece.className}>
                    {piece.text}
                  </span>
                ))}
                {"\n"}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </figure>
  );
}
