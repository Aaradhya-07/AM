"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  PromptInput,
  type PromptOption,
} from "../../components/ui/ai-chat-input";
import {
  betaDraft,
  betaDraftKey,
  betaEfforts,
  betaIdeaMax,
  betaIdeaMin,
} from "../../lib/beta-draft";
import styles from "./beta.module.css";

const examples = [
  {
    label: "Build an internal tool",
    idea: "Build an internal dashboard that shows which scheduled jobs are failing, who owns them, and how to retry a failed job safely.",
  },
  {
    label: "Integrate a local LLM",
    idea: "Connect a self-hosted LLM to my web app so users can generate structured project plans. Include timeouts and a way to check whether the endpoint is healthy.",
  },
  {
    label: "Plan a feature",
    idea: "Add CSV imports to a small inventory app. Users should preview column mappings, see invalid rows, and avoid creating duplicates when they retry an import.",
  },
];

export function BetaPrompt({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [error, setError] = useState("");
  const models: [PromptOption, ...PromptOption[]] = configured
    ? [
        { id: "configured", label: "Self-hosted" },
        { id: "google", label: "Gemini" },
        { id: "openai", label: "OpenAI" },
      ]
    : [
        { id: "google", label: "Gemini" },
        { id: "openai", label: "OpenAI" },
      ];

  return (
    <div className={styles.prompt}>
      <PromptInput
        value={idea}
        onChange={(value) => {
          setIdea(value);
          setError("");
        }}
        onSubmit={(value, { model, effort }) => {
          const draft = betaDraft.parse({
            idea: value,
            provider: model,
            effort,
          });
          try {
            sessionStorage.setItem(betaDraftKey, JSON.stringify(draft));
          } catch {
            setError(
              "This browser blocked draft storage. Your idea is still here and can be copied.",
            );
            return;
          }
          router.push("/plan?from=beta");
        }}
        models={models}
        efforts={betaEfforts}
        minLength={betaIdeaMin}
        maxLength={betaIdeaMax}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <ul className={styles.examples} aria-label="Example ideas">
        {examples.map((example) => (
          <li key={example.label}>
            <button
              type="button"
              onClick={() => {
                setIdea(example.idea);
                setError("");
              }}
            >
              {example.label} <span aria-hidden="true">↗</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
