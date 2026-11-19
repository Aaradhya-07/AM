"use client";

import { useEffect, useState } from "react";

const stages = [
  {
    label: "Restrict",
    title: "Start with the boundaries.",
    description:
      "Define the task, allowed setups and acceptance checks before comparing a single model.",
    fields: [
      ["01 / TASK", "A bounded piece of work"],
      ["02 / RESTRICTIONS", "Your non-negotiables"],
      ["03 / ACCEPTANCE", "Checks agreed in advance"],
    ],
  },
  {
    label: "Choose",
    title: "Make the reasoning visible.",
    description:
      "Compare eligible agent and model configurations with dated sources. Keep weak evidence explicit.",
    fields: [
      ["01 / ELIGIBILITY", "Restrictions come first"],
      ["02 / EVIDENCE", "Source, date and relevance"],
      ["03 / DECISION", "A choice you can explain"],
    ],
  },
  {
    label: "Run",
    title: "Keep what actually happened.",
    description:
      "Record attempts, associated changes and checks. Separate configured models from tool-reported identities.",
    fields: [
      ["01 / SETUP", "Configured ≠ tool-reported"],
      ["02 / CHANGES", "Associated with this run"],
      ["03 / CHECKS", "Results, within their scope"],
    ],
  },
  {
    label: "Review",
    title: "Close the loop with evidence.",
    description:
      "Keep human review separate from checks. Compare accepted work only when the evidence supports it.",
    fields: [
      ["01 / REVIEW", "A person's recorded decision"],
      ["02 / COST", "Measured, estimated or unknown"],
      ["03 / NEXT TIME", "A better-informed choice"],
    ],
  },
] as const;

export function DecisionObject() {
  const [active, setActive] = useState(0);
  const stage = stages[active] ?? stages[0];
  return (
    <div className="alpha-record-wrap">
      <span className="alpha-record-registration alpha-label">
        FIG. 01 — THE DECISION RECORD
      </span>
      <div className="alpha-record">
        <div className="alpha-record-top">
          <span className="alpha-label">ANVILMARK / DEVELOPMENT</span>
          <span className="alpha-record-dot" aria-hidden="true" />
        </div>
        <div className="alpha-record-title">
          <span className="alpha-record-number" aria-hidden="true">
            0{active + 1}
          </span>
          <h2>
            Nothing lost
            <br />
            between steps.
          </h2>
        </div>
        <div
          className="alpha-record-stages"
          role="group"
          aria-label="Explore the development workflow"
        >
          {stages.map((item, index) => (
            <button
              key={item.label}
              aria-pressed={active === index}
              onClick={() => setActive(index)}
            >
              <span className="alpha-label">0{index + 1}</span>
              {item.label}
              <span aria-hidden="true">{active === index ? "↘" : "·"}</span>
            </button>
          ))}
        </div>
        <div className="alpha-record-fields" key={active}>
          {stage.fields.map(([label, value]) => (
            <div key={label}>
              <span className="alpha-label">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
        <div className="alpha-record-bottom">
          <span className="alpha-label">WORKFLOW ANATOMY</span>
          <span className="alpha-label">NOT A LIVE RUN ↗</span>
        </div>
      </div>
      <div className="alpha-record-note" aria-live="polite">
        <span aria-hidden="true">↳</span>
        <div>
          <strong>{stage.title}</strong>
          <p>{stage.description}</p>
        </div>
      </div>
      <div className="alpha-record-stamp" aria-hidden="true">
        YOUR TOOLS.
        <br />
        YOUR RECORD.
      </div>
    </div>
  );
}

export function AlphaMotion() {
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-alpha-reveal]"),
    );
    let observer: IntersectionObserver | undefined;
    const show = () =>
      nodes.forEach((node) => node.classList.remove("alpha-await"));
    const sync = () => {
      observer?.disconnect();
      show();
      if (query.matches || typeof IntersectionObserver === "undefined") return;
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting || entry.boundingClientRect.bottom < 0) {
              entry.target.classList.remove("alpha-await");
              observer?.unobserve(entry.target);
            }
          }),
        { threshold: 0.08 },
      );
      nodes.forEach((node) => {
        if (node.getBoundingClientRect().top > innerHeight) {
          node.classList.add("alpha-await");
          observer?.observe(node);
        }
      });
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      observer?.disconnect();
      show();
      query.removeEventListener("change", sync);
    };
  }, []);
  return null;
}

export function CopyCommand({ command }: { command: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="alpha-code">
      <pre>
        <code>{command}</code>
      </pre>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setMessage("Copied");
          } catch {
            setMessage("Copy unavailable. Select the command instead.");
          }
        }}
        aria-label="Copy command"
      >
        Copy ↗
      </button>
      <span
        role="status"
        className={message.length > 12 ? "alpha-copy-message" : "sr-only"}
      >
        {message}
      </span>
    </div>
  );
}
