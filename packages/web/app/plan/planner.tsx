"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  betaDraft,
  betaDraftKey,
  betaPlanningDepth,
} from "../../lib/beta-draft";
import {
  estimateCost,
  makeHandoff,
  ratesChecked,
  strictChecks,
  type GeneratedPlan,
  type PlanningInput,
} from "../../lib/planner";

type Candidate = PlanningInput["candidates"][number];
type Provider = PlanningInput["provider"];

const defaults = {
  google: "gemini-3.1-flash-lite",
  openai: "gpt-5-mini",
  configured: "",
};

export function Planner({
  configured,
  configuredModel = "",
  serverGemini,
}: {
  configured: boolean;
  configuredModel?: string;
  serverGemini: boolean;
}) {
  const providerDefaults: Record<Provider, string> = {
    ...defaults,
    configured: configuredModel,
  };
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [provider, setProvider] = useState<Provider>(
    configured ? "configured" : "google",
  );
  const [model, setModel] = useState(
    configured ? configuredModel : defaults.google,
  );
  const [key, setKey] = useState("");
  const [strict, setStrict] = useState(false);
  const [models, setModels] = useState<(Candidate & { id: number })[]>([
    {
      id: 1,
      model: "gpt-5-mini",
      billing: "api",
      notes: "Use for narrow, well-specified tasks if available.",
    },
    {
      id: 2,
      model: "gpt-5",
      billing: "api",
      notes:
        "Consider for larger changes or ambiguous architecture if available.",
    },
  ]);
  const [nextId, setNextId] = useState(3);
  const [result, setResult] = useState<{
    plan: GeneratedPlan;
    strict: boolean;
    candidates: Candidate[];
    request: { idea: string; context: string };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localPrompt, setLocalPrompt] = useState("");
  const pinnedPairsRef = useRef<
    Map<string, Array<{ model: string; role: string; note: string }>>
  >(new Map());

  function switchTaskModel(taskIndex: number, nextModel: string) {
    setResult((current) => {
      if (!current) return current;
      const target = current.plan.tasks[taskIndex];
      if (!target || target.model === nextModel) return current;
      const pruned = target.alternatives.filter(
        (alt) => alt.model !== nextModel,
      );
      const nextAlts = pruned.some((alt) => alt.model === target.model)
        ? pruned
        : [
            {
              model: target.model,
              tradeoff: "Original recommended option.",
            },
            ...pruned,
          ].slice(0, 2);
      const nextTasks = current.plan.tasks.map((item, idx) =>
        idx === taskIndex
          ? { ...item, model: nextModel, alternatives: nextAlts }
          : item,
      );
      return {
        ...current,
        plan: {
          ...current.plan,
          tasks: nextTasks,
        },
      };
    });
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") !== "beta")
      return;
    try {
      const stored = sessionStorage.getItem(betaDraftKey);
      if (!stored) return;
      const draft = betaDraft.parse(JSON.parse(stored));
      const selectedProvider =
        draft.provider === "configured" && !configured
          ? "google"
          : draft.provider;
      setIdea(draft.idea);
      setContext(`Planning depth: ${betaPlanningDepth[draft.effort]}`);
      setProvider(selectedProvider);
      setModel(providerDefaults[selectedProvider]);
    } catch {
      // Keep the planner usable when there is no accessible Beta draft.
    }
  }, [configured, configuredModel]);

  function updateModel(id: number, patch: Partial<Candidate>) {
    setModels((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const candidates = models.map(({ model, billing, notes }) => ({
      model: model.trim(),
      billing,
      notes,
    }));
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          context,
          strict,
          provider,
          model,
          key,
          candidates,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Could not generate a plan.");
      setResult({
        plan: data.plan,
        strict,
        candidates,
        request: { idea, context },
      });
      setNotice("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not generate a plan.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Paste the prompt into the agent in your repository.");
    } catch {
      setNotice("Clipboard unavailable. Select and copy the prompt below.");
    }
  }

  function prepareLocal() {
    setLocalPrompt(
      [
        "Help me turn this rough request into a reviewed implementation plan. Inspect this repository and its instructions first. Use available AnvilMark planning tools if connected. Ask only questions that change scope, architecture, or verification. Explain architecture decisions and alternatives. Identify ordered tasks, acceptance checks and model suggestions, and show the plan for approval before changing application code.",
        `My request:\n${idea.trim()}`,
        context.trim() ? `Context:\n${context.trim()}` : "",
        strict ? `Strict verification:\n- ${strictChecks.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    setNotice("");
  }

  const plan = result?.plan;

  return (
    <>
      <form onSubmit={generate} className="planning-input">
        <fieldset disabled={busy}>
          <label htmlFor="idea">What do you want to build or change?</label>
          <textarea
            id="idea"
            required
            minLength={10}
            maxLength={12000}
            rows={5}
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="Customers paste the same CSV twice and get duplicate records. Make imports safe to repeat."
          />
          <label htmlFor="context">
            Constraints or repo context <small>Optional</small>
          </label>
          <textarea
            id="context"
            rows={3}
            maxLength={8000}
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Current stack, constraints, or answers to the plan’s open questions"
          />
          <label className="planning-toggle">
            <input
              type="checkbox"
              checked={strict}
              onChange={(event) => setStrict(event.target.checked)}
            />
            <span>
              Strict security review{" "}
              <small>
                Add risks, controls, and verification requirements to the
                handoff.
              </small>
            </span>
          </label>
          <button
            type="button"
            className="planning-secondary"
            disabled={idea.trim().length < 10}
            onClick={prepareLocal}
          >
            Prepare a local-first prompt
          </button>
          <h2>Planning model</h2>
          <div className="planning-grid">
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  const selected = event.target.value as Provider;
                  setProvider(selected);
                  setModel(providerDefaults[selected]);
                  setKey("");
                }}
              >
                <option value="google">
                  Google Gemini · free tier available
                </option>
                <option value="openai">OpenAI · bring your key</option>
                {configured && (
                  <option value="configured">
                    Configured endpoint · self-hosted or compatible
                  </option>
                )}
              </select>
            </label>
            <label>
              Model ID
              <input
                required
                value={model}
                maxLength={120}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
          </div>
          <label>
            API key{" "}
            {provider === "google" && serverGemini && (
              <small>Optional. Defaults to the server key.</small>
            )}
            {provider === "configured" && (
              <small>Optional for local endpoints</small>
            )}
            <input
              required={
                provider !== "configured" &&
                !(provider === "google" && serverGemini)
              }
              type="password"
              autoComplete="off"
              maxLength={512}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <p className="planning-note">
            Generating sends your brief and context to the selected provider
            through this server. The planner does not save your key.{" "}
            {provider === "google" && (
              <>
                Google says free-tier requests can be used to improve its
                products.{" "}
                <a href="https://ai.google.dev/gemini-api/docs/pricing">
                  Pricing and data use
                </a>
              </>
            )}
          </p>
          <details className="planning-models">
            <summary>Execution model options ({models.length})</summary>
            <p>
              Enter the setups you can access in your coding agent. These are
              separate from the model generating the plan.
            </p>
            {models.map((item, index) => (
              <div className="planning-model-row" key={item.id}>
                <label>
                  Model ID {index + 1}
                  <input
                    required
                    maxLength={120}
                    value={item.model}
                    onChange={(event) =>
                      updateModel(item.id, { model: event.target.value })
                    }
                  />
                </label>
                <label>
                  Billing
                  <select
                    value={item.billing}
                    onChange={(event) =>
                      updateModel(item.id, {
                        billing: event.target.value as Candidate["billing"],
                      })
                    }
                  >
                    <option value="api">API</option>
                    <option value="subscription">Subscription</option>
                    <option value="local">Local</option>
                  </select>
                </label>
                <label>
                  Fit or limits
                  <input
                    maxLength={200}
                    value={item.notes}
                    onChange={(event) =>
                      updateModel(item.id, { notes: event.target.value })
                    }
                  />
                </label>
                <button
                  className="planning-secondary"
                  type="button"
                  disabled={models.length < 2}
                  onClick={() =>
                    setModels(models.filter((entry) => entry.id !== item.id))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="planning-secondary"
              disabled={models.length >= 8}
              onClick={() => {
                setModels([
                  ...models,
                  { id: nextId, model: "", billing: "api", notes: "" },
                ]);
                setNextId(nextId + 1);
              }}
            >
              Add a model
            </button>
          </details>
          <button className="planning-primary" type="submit">
            {busy
              ? "Generating plan…"
              : plan
                ? "Regenerate plan"
                : "Generate plan"}
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="planning-error">
            {error}
          </p>
        )}
        {busy && <p role="status">Waiting for the planning model.</p>}
      </form>
      {localPrompt && (
        <section className="planning-card">
          <h2>Start in your local agent</h2>
          <p>
            This prompt asks Codex or Claude to inspect the repository and plan
            there. Update it by preparing a new prompt after editing your
            request.
          </p>
          <button
            className="planning-secondary"
            onClick={() => copy(localPrompt)}
          >
            Copy local-first prompt
          </button>
          <textarea
            readOnly
            aria-label="Local-first handoff prompt"
            rows={6}
            value={localPrompt}
          />
        </section>
      )}
      {plan && result && (
        <article className="planning-results">
          <section className="planning-card">
            <h2>{plan.title}</h2>
            <p>{plan.goal}</p>
            <p>
              <strong>Who it’s for</strong> {plan.users}
            </p>
            <div className="planning-grid">
              <List title="In scope" values={plan.scope} />
              <List title="Out of scope" values={plan.nonGoals} />
              <List title="Assumptions" values={plan.assumptions} />
              <List title="Open questions" values={plan.questions} />
            </div>
            {plan.questions.length > 0 && (
              <p className="planning-note">
                Add answers to the context field and regenerate to resolve these
                questions.
              </p>
            )}
          </section>
          <section className="planning-card">
            <h2>Architecture decisions</h2>
            <p className="planning-note">
              Proposed from your brief. Confirm them against the actual
              repository.
            </p>
            <div className="planning-grid">
              {plan.architecture.map((choice, index) => (
                <div className="planning-subcard" key={index}>
                  <h3>{choice.title}</h3>
                  <p>{choice.decision}</p>
                  <p>
                    <strong>Why</strong> {choice.why}
                  </p>
                  <p>
                    <strong>Alternative</strong> {choice.alternative}
                  </p>
                  <p>
                    <strong>Tradeoff</strong> {choice.tradeoff}
                  </p>
                </div>
              ))}
            </div>
            {plan.flows.length > 0 && (
              <div className="planning-flows">
                <h3>Data flows</h3>
                {plan.flows.map((flow, index) => (
                  <div key={index}>
                    <strong>
                      {flow.from} → {flow.to}
                    </strong>
                    <p>
                      {flow.data} · {flow.boundary}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="planning-card">
            <h2>Implementation tasks</h2>
            <p className="planning-note">
              Models are suggested from your available options. Token and cost
              estimates cover one attempt and exclude retries. Published rates
              were checked {ratesChecked}.
            </p>
            <ol className="planning-tasks">
              {plan.tasks.map((task, taskIdx) => {
                const candidate = result.candidates.find(
                  (item) => item.model === task.model,
                );
                const selection = candidate && estimateCost(task, candidate);
                const pairKey = `${plan.title}::${task.id}::${result.candidates
                  .map((c) => c.model)
                  .join(",")}`;
                let pair = pinnedPairsRef.current.get(pairKey);
                if (!pair) {
                  const primaryOpt = {
                    model: task.model,
                    role: "Recommended",
                    note: task.why,
                  };
                  const altCandidate =
                    task.alternatives.find((a) =>
                      result.candidates.some(
                        (c) => c.model === a.model && c.model !== task.model,
                      ),
                    ) ??
                    (result.candidates.find((c) => c.model !== task.model)
                      ? {
                          model: result.candidates.find(
                            (c) => c.model !== task.model,
                          )!.model,
                          tradeoff: "Alternative execution option.",
                        }
                      : null);
                  pair = altCandidate
                    ? [
                        primaryOpt,
                        {
                          model: altCandidate.model,
                          role: "Option 2",
                          note: altCandidate.tradeoff,
                        },
                      ]
                    : [primaryOpt];
                  pinnedPairsRef.current.set(pairKey, pair);
                }
                return (
                  <li key={task.id} className="planning-subcard">
                    <h3>{task.title}</h3>
                    <p>{task.outcome}</p>
                    {task.dependsOn.length > 0 && (
                      <p>
                        <strong>After</strong>{" "}
                        {task.dependsOn
                          .map(
                            (id) =>
                              plan.tasks.find((entry) => entry.id === id)
                                ?.title,
                          )
                          .join(", ")}
                      </p>
                    )}
                    <div className="planning-grid">
                      <List title="Done when" values={task.acceptance} />
                      <List title="Checks to run" values={task.checks} />
                    </div>
                    <h4>Suggested model · {task.model}</h4>
                    {pair.length >= 2 ? (
                      <div
                        className="planning-model-choices"
                        role="group"
                        aria-label={`Model options for ${task.title}`}
                      >
                        {pair.map((opt) => {
                          const isSelected = opt.model === task.model;
                          const optCand = result.candidates.find(
                            (c) => c.model === opt.model,
                          );
                          const optCost =
                            optCand && estimateCost(task, optCand);
                          return (
                            <button
                              key={opt.model}
                              type="button"
                              aria-pressed={isSelected}
                              className={`planning-choice-pill ${
                                isSelected ? "planning-choice-pill-active" : ""
                              }`}
                              onClick={() => switchTaskModel(taskIdx, opt.model)}
                            >
                              <span className="planning-choice-top">
                                <span>
                                  {isSelected ? "● " : "○ "}
                                  <strong>{opt.model}</strong> ({opt.role})
                                </span>
                                {optCost && (
                                  <small>~${optCost.usd.toFixed(4)}</small>
                                )}
                              </span>
                              <small>{opt.note}</small>
                            </button>
                          );
                        })}
                        {result.candidates.length > 2 && (
                          <label className="planning-other-model">
                            <span>Other model</span>
                            <select
                              aria-label={`Model for ${task.title}`}
                              value={task.model}
                              onChange={(event) =>
                                switchTaskModel(taskIdx, event.target.value)
                              }
                            >
                              {result.candidates.map((c) => (
                                <option key={c.model} value={c.model}>
                                  {c.model}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    ) : (
                      <p>{task.why}</p>
                    )}
                    <p>
                      <strong>Estimated tokens</strong>{" "}
                      {task.inputTokens.toLocaleString()} input /{" "}
                      {task.outputTokens.toLocaleString()} output
                    </p>
                    <p>{task.estimateBasis}</p>
                    <p>
                      <strong>Estimated cost</strong>{" "}
                      {selection ? (
                        <>
                          {" "}
                          ${selection.usd.toFixed(4)} USD ·{" "}
                          <a href={selection.source}>Published API rates</a> ($
                          {selection.input} input / ${selection.output} output
                          per million tokens)
                        </>
                      ) : candidate?.billing === "subscription" ? (
                        "Incremental subscription cost unknown"
                      ) : candidate?.billing === "local" ? (
                        "Local hardware and electricity costs unestimated"
                      ) : (
                        "No sourced rate for this model"
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
          {(result.strict || plan.security.length > 0) && (
            <section className="planning-card">
              <h2>
                {result.strict
                  ? "Strict security review"
                  : "Security considerations"}
              </h2>
              <p className="planning-note">
                Verification is pending. The local agent must run the checks and
                report any unresolved risk.
              </p>
              {plan.security.map((item, index) => (
                <div className="planning-subcard" key={index}>
                  <h3>{item.risk}</h3>
                  <p>{item.control}</p>
                  <p>
                    <strong>Verify</strong> {item.verification}
                  </p>
                </div>
              ))}
              {result.strict && (
                <List title="Required review steps" values={strictChecks} />
              )}
            </section>
          )}
          <section className="planning-card">
            <h2>Continue in your repository</h2>
            <p>
              Open the repo in Codex or Claude and paste the handoff for review.
              The included checks and model routing are proposals for the local
              session.
            </p>
            <button
              className="planning-primary"
              onClick={() =>
                copy(makeHandoff(plan, result.strict, result.request))
              }
            >
              Copy agent handoff
            </button>
            <textarea
              readOnly
              aria-label="Generated agent handoff prompt"
              rows={7}
              value={makeHandoff(plan, result.strict, result.request)}
            />
          </section>
        </article>
      )}
      <p role="status" className={notice ? "planning-copy-status" : undefined}>
        {notice}
      </p>
    </>
  );
}

function List({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
