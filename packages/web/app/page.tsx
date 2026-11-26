import Link from "next/link";

import { AsciiAquarium } from "../components/ui/ascii-aquarium";
import { AlphaMotion } from "./components/alpha-interactions";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import styles from "./home.module.css";

const benefits = [
  {
    title: "Get the architecture right early",
    description:
      "Compare approaches against your existing stack, requirements, and constraints. See what the plan recommends, why it fits, and which trade-offs you’re accepting before code is written.",
  },
  {
    title: "Use fewer tokens on each task",
    description:
      "Give your agent a focused prompt with the context, dependencies, and checks for the task at hand. It can work through one small change at a time with less repeated context.",
  },
  {
    title: "Control AI costs over time",
    description:
      "Match models to the difficulty of each task and the tools you already pay for. Review token and API cost estimates before you run the plan so you can see where a cheaper model makes sense.",
  },
  {
    title: "Cut avoidable rework",
    description:
      "Agree on what’s in scope, what depends on what, and how to verify each task. Review smaller changes as they’re completed so mistakes are easier to catch and fix.",
  },
];

const workflow = [
  {
    title: "Describe what you want to build",
    description:
      "Start with an idea or a change to an existing project. Share what you use today and answer follow-up questions about what you need.",
  },
  {
    title: "Review your build plan",
    description:
      "Check the proposed architecture, task order, model recommendations, and token estimates. Refine the plan before you start coding.",
  },
  {
    title: "Build with your coding agent",
    description:
      "Download the plan or copy the full brief or an individual task prompt. Use it in your project with Codex, Claude Code, or Cursor.",
  },
];

export default function HomePage() {
  return (
    <div className={`alpha alpha-page ${styles.page}`}>
      <a href="#main" className="alpha-skip">
        Skip to content
      </a>
      <div className={styles.aquarium} aria-hidden="true">
        <AsciiAquarium style={{ minHeight: 0 }} />
      </div>
      <div className={styles.header}>
        <SiteHeader tone="dark" />
      </div>
      <main className={styles.main} tabIndex={-1} id="main">
        <section className={styles.hero} aria-labelledby="home-heading">
          <div className={`alpha-shell ${styles.heroCopy}`}>
            <h1 id="home-heading">
              From idea to <br />
              <em>build plan.</em>
            </h1>
            <p>
              AnvilMark plans what your coding agent will build. Turn an idea or
              a software change into an architecture, a task breakdown, and
              model picks for each step.
            </p>
            <Link href="/beta" className={styles.primaryAction}>
              Try the planner <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <a className={styles.methodLink} href="#why-anvilmark">
            Why plan first? <span aria-hidden="true">↓</span>
          </a>
        </section>
        <div className={styles.details}>
          <section
            id="why-anvilmark"
            className={`alpha-shell ${styles.benefits}`}
            aria-labelledby="benefits-heading"
          >
            <h2 id="benefits-heading" data-alpha-reveal>
              Why plan <em>before you build?</em>
            </h2>
            <ul className={styles.benefitList} role="list">
              {benefits.map(({ title, description }) => (
                <li key={title} data-alpha-reveal>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ul>
          </section>
          <section
            id="the-method"
            className={`alpha-shell ${styles.workflow}`}
            aria-labelledby="workflow-heading"
          >
            <h2 id="workflow-heading" data-alpha-reveal>
              How AnvilMark works
            </h2>
            <ol className={styles.steps} role="list">
              {workflow.map(({ title, description }, index) => (
                <li key={title} data-alpha-reveal>
                  <span
                    className={`alpha-label ${styles.stepNumber}`}
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          </section>
          <section
            className={`alpha-shell ${styles.closing}`}
            aria-labelledby="start-heading"
          >
            <h2 id="start-heading" data-alpha-reveal>
              Plan your <em>next build.</em>
            </h2>
            <Link href="/beta" className={styles.primaryAction}>
              Try the planner <span aria-hidden="true">↗</span>
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter />
      <AlphaMotion />
    </div>
  );
}
