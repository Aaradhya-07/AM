"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  createDraftContract,
  demoExample,
  emptyDraft,
  type DemoCandidate,
  type DemoDraft,
} from "../../lib/draft-contract";
import {
  ARCHITECTURE_PATTERNS,
  architectureConflict,
} from "../../lib/architecture-guide";
import {
  MODEL_STARTERS,
  candidateFromStarter,
  getModelStarter,
  starterFit,
} from "../../lib/model-starters";

const fieldClass =
  "mt-2 w-full rounded border border-line-muted bg-ink px-3 py-2.5 text-sm text-canvas outline-none focus:border-gold";
const labelClass = "block text-sm font-medium text-sand";

type PublishedEvals = {
  model_id: string;
  source_url: string;
  fetched_at: string;
  response_sha256: string;
  results: {
    benchmark_id: string;
    task_id: string | null;
    score: number;
    evaluation_date: string | null;
    verified: boolean | null;
    source_url: string | null;
  }[];
};
type Lookup = {
  modelId: string;
  status: "loading" | "ready" | "error";
  data?: PublishedEvals;
  message?: string;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
      />
    </label>
  );
}

function deploymentLabel(candidate: DemoCandidate): string {
  if (candidate.deployment === "local")
    return `Local${candidate.provider.trim() ? ` · ${candidate.provider.trim()}` : ""}`;
  const mode =
    candidate.deployment === "managed_api" ? "Managed API" : "Self hosted";
  return `${mode}${candidate.provider.trim() ? ` · ${candidate.provider.trim()}` : ""}${candidate.region.trim() ? ` · ${candidate.region.trim()}` : ""}`;
}

export function DemoClient() {
  const [draft, setDraft] = useState<DemoDraft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [lookups, setLookups] = useState<Record<number, Lookup>>({});
  const update = <K extends keyof DemoDraft>(key: K, value: DemoDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
    setExported(false);
  };
  const updateCandidate = (
    index: number,
    key: keyof DemoCandidate,
    value: string,
  ) => {
    update(
      "candidates",
      draft.candidates.map((candidate, position) =>
        position === index ? { ...candidate, [key]: value } : candidate,
      ),
    );
  };

  const selectStarter = (index: number, modelId: string) => {
    const starter = getModelStarter(modelId);
    update(
      "candidates",
      draft.candidates.map((candidate, position) =>
        position === index
          ? starter
            ? candidateFromStarter(starter)
            : { ...candidate, model: "", version: "" }
          : candidate,
      ),
    );
  };

  const orderedStarters = [...MODEL_STARTERS].sort((left, right) => {
    const score = (starter: (typeof MODEL_STARTERS)[number]) =>
      Number(starter.workloadKinds.includes(draft.workloadKind)) * 2 +
      Number(
        (starter.deployment === "local") ===
          (draft.architecturePattern === "local"),
      );
    return score(right) - score(left);
  });

  const comparison = useMemo(
    () =>
      draft.candidates.map((candidate) => ({
        candidate,
        boundary:
          draft.privacy === "local_only" && candidate.deployment !== "local"
            ? draft.architecturePattern === "redacted_remote"
              ? "Remote use depends on a redactor that still needs implementation and evidence."
              : "Conflicts with the local-only input boundary. Use local processing or verify a redaction path."
            : draft.architecturePattern === "local" &&
                candidate.deployment !== "local"
              ? "This managed model needs a different architecture path."
              : draft.architecturePattern !== "local" &&
                  candidate.deployment === "local"
                ? "This local alternative needs the local architecture path."
                : candidate.deployment === "local"
                  ? "Local deployment declared. Hardware fit and runtime configuration still need evidence."
                  : "Remote deployment declared. Verify provider, region, and data handling before selection.",
        missing: [
          draft.qualityMinimum.trim()
            ? `${draft.qualityMetric || "Quality"} evaluation on your data`
            : "Quality evaluation on your data",
          "Measured latency and token use",
          "Effective cost at expected usage",
          ...(candidate.version.trim() ? [] : ["Pinned model version"]),
          ...(candidate.deployment === "local"
            ? ["Hardware fit"]
            : ["Provider data policy"]),
        ],
      })),
    [draft],
  );
  const hasCandidate = draft.candidates.some((candidate) =>
    candidate.model.trim(),
  );

  const loadExample = () => {
    setDraft(demoExample);
    setLookups({});
    setError(null);
    setExported(false);
  };

  const lookupPublishedEvals = async (index: number, modelId: string) => {
    const trimmed = modelId.trim();
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
      setLookups((current) => ({
        ...current,
        [index]: {
          modelId: trimmed,
          status: "error",
          message: "Enter an exact Hugging Face publisher/model ID.",
        },
      }));
      return;
    }
    setLookups((current) => ({
      ...current,
      [index]: { modelId: trimmed, status: "loading" },
    }));
    try {
      const response = await fetch(
        `/api/quality/model?id=${encodeURIComponent(trimmed)}`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Lookup failed.");
      setLookups((current) => ({
        ...current,
        [index]: {
          modelId: trimmed,
          status: "ready",
          data: payload as PublishedEvals,
        },
      }));
    } catch (cause) {
      setLookups((current) => ({
        ...current,
        [index]: {
          modelId: trimmed,
          status: "error",
          message: cause instanceof Error ? cause.message : "Lookup failed.",
        },
      }));
    }
  };

  const download = () => {
    try {
      const contract = createDraftContract(draft, new Date().toISOString());
      const blob = new Blob([`${JSON.stringify(contract, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${contract.project.id}.anvilmark.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(null);
      setExported(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not build the contract.",
      );
      setExported(false);
    }
  };

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line-muted bg-surface px-5 py-4 text-sm sm:px-7">
          <p className="text-sand/75">
            Start with your project, or inspect a sample draft.
          </p>
          <button
            type="button"
            className="text-gold hover:underline"
            onClick={loadExample}
          >
            Load support triage example →
          </button>
        </div>

        <section className="rounded border border-line-muted bg-surface p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-xs text-gold">01</span>
            <h2 className="font-brand text-2xl">Contract intent</h2>
          </div>
          <div className="space-y-4">
            <Field
              label="Project name"
              value={draft.name}
              onChange={(value) => update("name", value)}
            />
            <label className={labelClass}>
              What should it do?
              <textarea
                className={`${fieldClass} min-h-24`}
                value={draft.idea}
                onChange={(event) => update("idea", event.target.value)}
              />
            </label>
            <Field
              label="Who uses it?"
              value={draft.user}
              onChange={(value) => update("user", value)}
              placeholder="Optional"
            />
          </div>
        </section>

        <section className="rounded border border-line-muted bg-surface p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-xs text-gold">02</span>
            <h2 className="font-brand text-2xl">Workload and restrictions</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="One AI workload"
              value={draft.workload}
              onChange={(value) => update("workload", value)}
            />
            <label className={labelClass}>
              Workload type
              <select
                className={fieldClass}
                value={draft.workloadKind}
                onChange={(event) =>
                  update(
                    "workloadKind",
                    event.target.value as DemoDraft["workloadKind"],
                  )
                }
              >
                <option value="classification">
                  Classification or routing
                </option>
                <option value="extraction">Structured extraction</option>
                <option value="drafting">Text drafting</option>
                <option value="reasoning">Reasoning or analysis</option>
                <option value="other">Other</option>
              </select>
            </label>
            <Field
              label="Input data label"
              value={draft.inputClassification}
              onChange={(value) => update("inputClassification", value)}
              placeholder="lower_snake_case"
            />
            <label className={labelClass}>
              Output format
              <select
                className={fieldClass}
                value={draft.output}
                onChange={(event) =>
                  update("output", event.target.value as DemoDraft["output"])
                }
              >
                <option value="plain_text">Plain text</option>
                <option value="cited_text">Cited text</option>
                <option value="ranked_document_refs">
                  Ranked document references
                </option>
              </select>
            </label>
            <label className={labelClass}>
              Input data boundary
              <select
                className={fieldClass}
                value={draft.privacy}
                onChange={(event) =>
                  update("privacy", event.target.value as DemoDraft["privacy"])
                }
              >
                <option value="local_only">Must stay local</option>
                <option value="remote_allowed">
                  Remote use may be considered
                </option>
              </select>
            </label>
          </div>
          <details className="mt-5 rounded border border-line-muted bg-ink/40 p-4">
            <summary className="cursor-pointer text-sm font-medium text-gold">
              Add planning limits (optional)
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Expected calls per month"
                value={draft.callsPerMonth}
                onChange={(value) => update("callsPerMonth", value)}
                placeholder="Unknown"
                type="number"
              />
              <Field
                label="Monthly budget (USD)"
                value={draft.monthlyBudget}
                onChange={(value) => update("monthlyBudget", value)}
                placeholder="Unset"
                type="number"
              />
              <Field
                label="Quality metric"
                value={draft.qualityMetric}
                onChange={(value) => update("qualityMetric", value)}
                placeholder="e.g. classification_f1"
              />
              <Field
                label="Minimum quality target"
                value={draft.qualityMinimum}
                onChange={(value) => update("qualityMinimum", value)}
                placeholder="e.g. 0.9"
                type="number"
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-sand/55">
              Empty values remain unknown. A target stays unverified until you
              measure it on your data.
            </p>
          </details>
        </section>

        <section className="rounded border border-line-muted bg-surface p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-xs text-gold">03</span>
            <h2 className="font-brand text-2xl">Architecture path</h2>
          </div>
          <p className="mb-5 max-w-2xl text-sm leading-6 text-sand/70">
            Choose where the input and model run. This adds a draft data-flow
            map to your contract. It does not prove that the system is built or
            that redaction works.
          </p>
          <fieldset>
            <legend className="sr-only">Architecture path</legend>
            <div className="grid gap-3">
              {ARCHITECTURE_PATTERNS.map((pattern) => (
                <label
                  key={pattern.id}
                  className={`cursor-pointer rounded border p-4 transition-colors ${
                    draft.architecturePattern === pattern.id
                      ? "border-gold bg-gold/5"
                      : "border-line-muted bg-ink/40 hover:border-gold/50"
                  }`}
                >
                  <span className="flex items-center gap-3 text-sm font-medium text-canvas">
                    <input
                      type="radio"
                      name="architecture-pattern"
                      value={pattern.id}
                      checked={draft.architecturePattern === pattern.id}
                      onChange={() => update("architecturePattern", pattern.id)}
                      className="accent-gold"
                    />
                    {pattern.title}
                  </span>
                  <span className="mt-2 block pl-6 font-mono text-xs text-gold">
                    {pattern.flow}
                  </span>
                  {draft.architecturePattern === pattern.id && (
                    <span className="mt-2 block pl-6 text-xs leading-5 text-sand/65">
                      {pattern.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {architectureConflict(draft) && (
            <p
              role="alert"
              className="mt-4 rounded border border-red-400/40 p-3 text-sm text-red-200"
            >
              {architectureConflict(draft)}
            </p>
          )}
        </section>

        <section className="rounded border border-line-muted bg-surface p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="font-mono text-xs text-gold">04</span>
            <h2 className="font-brand text-2xl">Compare models</h2>
          </div>
          <p className="mb-5 text-sm leading-6 text-sand/70">
            Select sourced starting points or enter your own model. The notes
            describe published capabilities. They are not scores for your
            workload or a recommendation to approve a model.
          </p>
          <div className="space-y-5">
            {draft.candidates.map((candidate, index) => (
              <div
                className="rounded border border-line-muted bg-ink/60 p-4"
                key={index}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-canvas">
                    Candidate {index + 1}
                  </h3>
                  {draft.candidates.length > 2 && (
                    <button
                      type="button"
                      className="text-xs text-sand/65 hover:text-gold"
                      onClick={() =>
                        update(
                          "candidates",
                          draft.candidates.filter(
                            (_, position) => position !== index,
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={`${labelClass} sm:col-span-2`}>
                    Choose a model
                    <select
                      className={fieldClass}
                      value={getModelStarter(candidate.model)?.id ?? "custom"}
                      onChange={(event) =>
                        selectStarter(index, event.target.value)
                      }
                    >
                      <option value="custom">Custom model or runtime</option>
                      {orderedStarters.map((starter) => (
                        <option key={starter.id} value={starter.id}>
                          {starter.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!getModelStarter(candidate.model) && (
                    <Field
                      label="Model or runtime ID"
                      value={candidate.model}
                      onChange={(value) =>
                        updateCandidate(index, "model", value)
                      }
                      placeholder="Exact provider ID or publisher/model"
                    />
                  )}
                </div>
                {getModelStarter(candidate.model) && (
                  <div className="mt-4 rounded border border-line-muted bg-surface/70 p-4 text-xs leading-5 text-sand/75">
                    <p className="font-medium text-gold">
                      {starterFit(
                        getModelStarter(candidate.model)!,
                        draft,
                        candidate.deployment,
                      )}
                    </p>
                    <p className="mt-2">
                      <span className="font-medium text-canvas">
                        Documented strength:
                      </span>{" "}
                      {getModelStarter(candidate.model)!.strength}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium text-canvas">
                        Still verify:
                      </span>{" "}
                      {getModelStarter(candidate.model)!.verify}
                    </p>
                    <a
                      href={getModelStarter(candidate.model)!.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-block text-gold hover:underline"
                    >
                      Official model source ↗
                    </a>
                  </div>
                )}
                <details className="mt-4 border-t border-line-muted pt-3">
                  <summary className="cursor-pointer text-xs font-medium text-gold">
                    Deployment and version details
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Exact version or revision"
                      value={candidate.version}
                      onChange={(value) =>
                        updateCandidate(index, "version", value)
                      }
                      placeholder="Unknown / floating"
                    />
                    <label className={labelClass}>
                      Deployment
                      <select
                        className={fieldClass}
                        value={candidate.deployment}
                        onChange={(event) =>
                          updateCandidate(
                            index,
                            "deployment",
                            event.target.value,
                          )
                        }
                      >
                        <option value="local">Local</option>
                        <option value="managed_api">Managed API</option>
                        <option value="self_hosted">Self hosted</option>
                      </select>
                    </label>
                    <Field
                      label={
                        candidate.deployment === "local"
                          ? "Local runtime"
                          : "Provider"
                      }
                      value={candidate.provider}
                      onChange={(value) =>
                        updateCandidate(index, "provider", value)
                      }
                      placeholder="Unknown"
                    />
                    {candidate.deployment !== "local" && (
                      <Field
                        label="Region"
                        value={candidate.region}
                        onChange={(value) =>
                          updateCandidate(index, "region", value)
                        }
                        placeholder="Unknown"
                      />
                    )}
                  </div>
                </details>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="mt-4 text-sm text-gold hover:underline"
            onClick={() =>
              update("candidates", [
                ...draft.candidates,
                {
                  model: "",
                  version: "",
                  deployment: "managed_api",
                  provider: "",
                  region: "",
                },
              ])
            }
          >
            + Add candidate
          </button>
        </section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-[calc(var(--am-header-h)+1.5rem)] lg:self-start">
        <section className="rounded border border-gold/35 bg-surface p-5 sm:p-7">
          <p className="font-mono text-xs uppercase tracking-brand text-gold">
            Comparison · draft only
          </p>
          <h2 className="mt-2 font-brand text-2xl">What is known so far</h2>
          <p className="mt-3 text-sm leading-6 text-sand/65">
            These paths are recorded from your inputs. You can inspect published
            Hugging Face evaluations for an exact Hub model ID. Such scores do
            not test your workload; there is no winner or approval here.
          </p>
          {!hasCandidate && (
            <p className="mt-5 rounded border border-line-muted bg-ink/60 p-4 text-sm text-sand/75">
              Select two model paths to see their deployment fit and evidence
              gaps.
            </p>
          )}
          {hasCandidate && (
            <div className="mt-5 space-y-4">
              {comparison.map(({ candidate, boundary, missing }, index) =>
                candidate.model.trim() ? (
                  <div
                    className="rounded border border-line-muted bg-ink/60 p-4"
                    key={index}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-medium text-canvas">
                        {candidate.model.trim() || `Candidate ${index + 1}`}
                      </h3>
                      <span className="whitespace-nowrap rounded bg-gold/10 px-2 py-1 font-mono text-[10px] uppercase text-gold">
                        Unevaluated
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-sand/70">
                      {deploymentLabel(candidate)}
                      {candidate.version.trim()
                        ? ` · ${candidate.version.trim()}`
                        : " · floating version"}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-sand/80">
                      {boundary}
                    </p>
                    <details className="mt-4 text-xs text-sand/65">
                      <summary className="cursor-pointer font-medium text-gold">
                        Evidence needed ({missing.length})
                      </summary>
                      <ul className="mt-2 space-y-1 pl-4">
                        {missing.map((item) => (
                          <li key={item} className="list-disc">
                            {item}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <div className="mt-4 border-t border-line-muted pt-4">
                      <button
                        type="button"
                        className="text-xs text-gold hover:underline disabled:opacity-50"
                        disabled={lookups[index]?.status === "loading"}
                        onClick={() =>
                          lookupPublishedEvals(index, candidate.model)
                        }
                      >
                        {lookups[index]?.status === "loading"
                          ? "Checking published evaluations…"
                          : "Check Hugging Face evaluations →"}
                      </button>
                      {lookups[index]?.modelId === candidate.model.trim() &&
                        lookups[index]?.status === "error" && (
                          <p className="mt-2 text-xs leading-5 text-sand/65">
                            {lookups[index]?.message}
                          </p>
                        )}
                      {lookups[index]?.modelId === candidate.model.trim() &&
                        lookups[index]?.status === "ready" &&
                        lookups[index]?.data && (
                          <div className="mt-3 text-xs leading-5 text-sand/70">
                            <p>
                              <a
                                href={lookups[index].data.source_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-gold hover:underline"
                              >
                                Hugging Face model page ↗
                              </a>{" "}
                              · fetched{" "}
                              {new Date(
                                lookups[index].data.fetched_at,
                              ).toLocaleDateString()}
                            </p>
                            <p className="mt-1 font-mono text-[10px]">
                              Response SHA-256:{" "}
                              {lookups[index].data.response_sha256.slice(0, 16)}
                              …
                            </p>
                            {lookups[index].data.results.length === 0 ? (
                              <p className="mt-2">
                                No published evaluations were returned for this
                                model.
                              </p>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {lookups[index].data.results
                                  .slice(0, 5)
                                  .map((result, position) => (
                                    <li
                                      key={`${result.benchmark_id}-${position}`}
                                    >
                                      {result.benchmark_id}
                                      {result.task_id
                                        ? ` / ${result.task_id}`
                                        : ""}
                                      : {result.score} ·{" "}
                                      {result.verified === true
                                        ? "verified submission"
                                        : result.verified === false
                                          ? "unverified submission"
                                          : "verification unknown"}
                                      {result.evaluation_date
                                        ? ` · ${result.evaluation_date.slice(0, 10)}`
                                        : ""}
                                      {result.source_url && (
                                        <>
                                          {" · "}
                                          <a
                                            href={result.source_url}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="text-gold hover:underline"
                                          >
                                            source ↗
                                          </a>
                                        </>
                                      )}
                                    </li>
                                  ))}
                              </ul>
                            )}
                            {lookups[index].data.results.length > 5 && (
                              <p className="mt-1">
                                Showing 5 of{" "}
                                {lookups[index].data.results.length} published
                                results.
                              </p>
                            )}
                            <p className="mt-2 text-sand/55">
                              Scores have benchmark-specific meanings. They do
                              not establish quality on this workload.
                            </p>
                          </div>
                        )}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="mt-5 rounded border border-red-400/40 p-3 text-xs leading-5 text-red-200"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={download}
            className="am-btn am-btn-primary mt-6 w-full justify-center"
          >
            Download draft contract →
          </button>
          <p className="mt-3 text-xs leading-5 text-sand/55">
            Generated and validated in this browser. The file is schema draft.5
            JSON; it has no approved decision.
          </p>
        </section>
        {exported && (
          <section className="rounded border border-line-muted bg-surface p-5 text-sm text-sand/75">
            <h2 className="font-medium text-canvas">Continue locally</h2>
            <p className="mt-2">
              In a new project directory, run{" "}
              <code className="font-mono text-gold">
                anvilmark init --from-contract FILE
              </code>
              , then{" "}
              <code className="font-mono text-gold">anvilmark compare</code>.
              Review evidence before proposing and approving a decision.
            </p>
            <Link
              href="/start"
              className="mt-3 inline-block text-gold hover:underline"
            >
              CLI setup guide →
            </Link>
          </section>
        )}
      </aside>
    </div>
  );
}
