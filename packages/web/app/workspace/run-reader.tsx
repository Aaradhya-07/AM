"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  MAX_RECORD_BYTES,
  parseDevelopmentRecord,
  recordedCheckStanding,
  recordedCost,
  type DevelopmentRecord,
} from "../../lib/development-record";

export function RunReader() {
  const [run, setRun] = useState<DevelopmentRecord | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const serial = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (run) heading.current?.focus();
  }, [run]);
  async function open(file?: File) {
    if (!file) return;
    const request = ++serial.current;
    setError("");
    setBusy(true);
    try {
      if (file.size > MAX_RECORD_BYTES)
        throw new Error(
          "This file is too large. Choose a development-run JSON file smaller than 2 MiB.",
        );
      const raw = await file.text();
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new Error(
          "This file is not valid JSON. Choose the original development-run file.",
        );
      }
      const parsed = parseDevelopmentRecord(value);
      if (request !== serial.current) return;
      setRun(parsed);
      setFileName(file.name);
    } catch (reason) {
      if (request === serial.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not read this file. Try another development-run JSON file.",
        );
    } finally {
      if (request === serial.current) setBusy(false);
    }
  }
  const standing = run ? recordedCheckStanding(run) : "unknown";
  const checks = run
    ? [
        ...run.checks,
        ...(run.diff_check
          ? [
              {
                ...run.diff_check,
                name: `${run.diff_check.name} (independent diff)`,
              },
            ]
          : []),
      ]
    : [];
  const reportedModels = run
    ? [...new Set(run.model_events.map((event) => event.model))]
    : [];
  return (
    <>
      <div role="status" className="sr-only">
        {busy ? "Reading file…" : ""}
      </div>
      {error && (
        <div role="alert" className="alpha-error">
          {error}
          {run && " Your previously opened record is still displayed below."}
        </div>
      )}
      <section
        className={`alpha-import ${dragging ? "is-dragging" : ""}`}
        aria-label="Open a development-run file"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void open(event.dataTransfer.files[0]);
        }}
      >
        <span className="alpha-label">LOCAL FILE / NO UPLOAD</span>
        <h2>{run ? "Open another record." : "Your record belongs here."}</h2>
        <p>
          Choose or drop a JSON file from{" "}
          <code>.anvilmark/development/runs/</code>. Read-only, up to 2 MiB. No
          example data, no account, no server transfer.
        </p>
        <input
          ref={input}
          className="alpha-file-input"
          type="file"
          accept=".json,application/json"
          aria-label="Choose development-run JSON"
          disabled={busy}
          onChange={(event) => {
            void open(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>
      {!run ? (
        <p className="alpha-note">
          No recorded run yet?{" "}
          <Link className="alpha-text-link" href="/start">
            Start with your own repository ↗
          </Link>
        </p>
      ) : (
        <>
          <div className="alpha-run-toolbar">
            <div>
              <p className="alpha-label">OPENED FROM {fileName}</p>
              <h2
                ref={heading}
                tabIndex={-1}
                style={{ fontSize: "28px", overflowWrap: "anywhere" }}
              >
                {run.task_id}
              </h2>
            </div>
            <button
              onClick={() => {
                serial.current++;
                setBusy(false);
                setRun(null);
                setError("");
                setFileName("");
                input.current?.focus();
              }}
            >
              Close record ×
            </button>
          </div>
          <p className="alpha-note alpha-import-notice">
            Imported record · not independently verified. File integrity,
            current repository state and human review are not established here.
            A passing check does not mean the work was accepted.
          </p>
          <div className="alpha-run-summary">
            <div>
              <span className="alpha-label">RECORDED CHECKS</span>
              <h2>
                {standing === "passed"
                  ? "Passed in record"
                  : standing === "failed"
                    ? "Failure recorded"
                    : "Unknown"}
              </h2>
              <p>
                Agent exit, recorded checks and any boundary violations. Scope
                is limited to this file.
              </p>
            </div>
            <div>
              <span className="alpha-label">HUMAN REVIEW</span>
              <h2>Not established</h2>
              <p>
                This run file does not establish a matching, current human
                acceptance decision.
              </p>
            </div>
            <div>
              <span className="alpha-label">COST BASIS</span>
              <h2>{recordedCost(run)}</h2>
              <p>
                {run.billing === "subscription_allowance"
                  ? "Subscription allowance. Incremental cash cost is unknown."
                  : "API-rate estimate from recorded usage. This is not an invoice."}
              </p>
            </div>
          </div>
          <section className="alpha-run-section">
            <h2>The setup, as recorded.</h2>
            <dl className="alpha-run-details">
              {[
                ["Run ID", run.id],
                ["Architecture", run.architecture_id],
                ["Configured model", run.configured_model],
                [
                  "Tool-reported models",
                  reportedModels.join(", ") || "None recorded",
                ],
                ["Identity basis", run.model_identity.replaceAll("_", " ")],
                ["Candidate", run.candidate_id],
                ["Started", run.started_at],
                ["Finished", run.finished_at],
                ["Base commit", run.base_commit],
                ["Plan hash", run.plan_hash],
                [
                  "Approval at run start",
                  `${run.approval_at_start.replaceAll("_", " ")} (recorded only)`,
                ],
                [
                  "Approval actor",
                  run.approval_actor_at_start?.replaceAll("_", " ") ||
                    "Unknown",
                ],
                [
                  "Input tokens",
                  run.usage.input_tokens.toLocaleString("en-US"),
                ],
                [
                  "Output tokens",
                  run.usage.output_tokens.toLocaleString("en-US"),
                ],
                [
                  "Cached input tokens",
                  run.usage.cached_input_tokens.toLocaleString("en-US"),
                ],
                [
                  "Reasoning output tokens",
                  run.usage.reasoning_output_tokens.toLocaleString("en-US"),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {run.approval_actor_at_start === "agent_test_operator" && (
              <p className="alpha-error">
                This record used an agent-test approval. It must not count as
                human-approved outcome evidence.
              </p>
            )}
          </section>
          <section className="alpha-run-section">
            <h2>Checks, within their scope.</h2>
            {checks.length === 0 ? (
              <p className="alpha-note">No checks recorded.</p>
            ) : (
              checks.map((check, index) => (
                <div className="alpha-check" key={`${check.name}-${index}`}>
                  <span
                    className={`alpha-status ${check.exit_code !== null && check.exit_code !== 0 ? "alpha-status-fail" : ""}`}
                  >
                    {check.exit_code === null
                      ? "UNKNOWN"
                      : check.exit_code === 0
                        ? "PASS"
                        : "FAIL"}
                  </span>
                  <div>
                    <strong>{check.name}</strong>
                    <pre>{JSON.stringify(check.argv)}</pre>
                  </div>
                  <span>
                    {Math.round(check.duration_ms)} ms · exit{" "}
                    {check.exit_code ?? "unknown"}
                  </span>
                </div>
              ))
            )}
            {run.architecture_check && (
              <p className="alpha-note">
                Architecture boundary:{" "}
                {run.architecture_check.violations.length
                  ? run.architecture_check.violations.join("; ")
                  : "no violations recorded"}
                .
              </p>
            )}
          </section>
          <section className="alpha-run-section">
            <h2>Associated changes.</h2>
            <p className="alpha-note">
              A run-to-change association does not establish line-by-line model
              authorship.
            </p>
            <ul className="alpha-changed-paths">
              {run.changed_paths.map((path, index) => (
                <li key={`${path}-${index}`}>{path}</li>
              ))}
            </ul>
            {run.changed_paths.length === 0 && (
              <p className="alpha-note">No changed paths recorded.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
