import Link from "next/link";
import { SiteHeader } from "./components/site-header";
import { SiteFooter } from "./components/site-footer";
import { AlphaMotion } from "./components/alpha-interactions";
import { AsciiAquarium } from "../components/ui/ascii-aquarium";
import styles from "./home.module.css";
import { GITHUB_URL } from "./components/circuitry";

const workflow = [
  [
    "01",
    "Understand the work.",
    "Start from your repository, its architecture and its conventions. Define a task small enough to review.",
    "Repository → bounded task",
  ],
  [
    "02",
    "Choose with a reason.",
    "Filter by your restrictions. Compare agent and model setups using dated public evidence and relevant local outcomes.",
    "Restrictions → eligible setups",
  ],
  [
    "03",
    "Keep the whole story.",
    "Capture attempts, changes and checks. Review the result, including rework and what the cost record can actually establish.",
    "Run → review → next decision",
  ],
];

export default function HomePage() {
  return (
    <div className="alpha alpha-page">
      <a href="#main" className="alpha-skip">
        Skip to content
      </a>
      <div className={styles.header}>
        <SiteHeader tone="dark" />
      </div>
      <main tabIndex={-1} id="main">
        <section className={styles.hero} aria-labelledby="home-heading">
          <div className={styles.aquarium} aria-hidden="true">
            <AsciiAquarium style={{ minHeight: 0 }} />
          </div>
          <div className={`alpha-shell ${styles.heroCopy}`}>
            <h1 id="home-heading">
              Good decisions.
              <br />
              Kept on <em>record.</em>
            </h1>
            <p>
              Plan the change, choose a model, and keep a record of what your
              coding agent delivered.
            </p>
            <div className={styles.actions}>
              <Link href="/beta" className={styles.primaryAction}>
                Plan a change <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/start" className={styles.secondaryAction}>
                Start locally <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
          <a className={styles.methodLink} href="#the-method">
            Meet the method <span aria-hidden="true">↓</span>
          </a>
        </section>
        <section id="the-method" className="alpha-method alpha-shell">
          <div className="alpha-section-intro" data-alpha-reveal>
            <p className="alpha-label">01 / THE METHOD</p>
            <h2>
              The model is one choice.
              <br />
              <span className="alpha-muted">The work is the whole story.</span>
            </h2>
            <p>
              Public benchmarks start a conversation. Your task, restrictions
              and reviewed outcomes give that conversation context. Anvilmark
              keeps them together.
            </p>
          </div>
          <div className="alpha-workflow">
            {workflow.map(([number, title, body, caption]) => (
              <article key={number} data-alpha-reveal>
                <span className="alpha-workflow-number">
                  {number}
                  <span aria-hidden="true">↘</span>
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="alpha-label">{caption}</span>
              </article>
            ))}
          </div>
        </section>
        <section className="alpha-forest">
          <div className="alpha-shell alpha-forest-inner">
            <div data-alpha-reveal>
              <p className="alpha-label">02 / A RECORD, NOT A GUESS</p>
              <h2>
                Keep the why.
                <br />
                And the
                <br />
                <em>what happened.</em>
              </h2>
              <p>
                Your agent does the work. Anvilmark records the choices, checks
                and review around it—so the next decision has something to build
                on.
              </p>
              <Link
                href="/workspace"
                className="alpha-button alpha-button-light"
              >
                Open your records <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="alpha-evidence-stack" data-alpha-reveal>
              <div>
                <span className="alpha-label">THE CHOICE</span>
                <h3>What you intended.</h3>
                <p>Task · constraints · selected setup</p>
                <span aria-hidden="true">01</span>
              </div>
              <div>
                <span className="alpha-label">THE RUN</span>
                <h3>What was recorded.</h3>
                <p>Attempts · changes · scoped checks</p>
                <span aria-hidden="true">02</span>
              </div>
              <div>
                <span className="alpha-label">THE REVIEW</span>
                <h3>What held up.</h3>
                <p>Human acceptance · rework · cost basis</p>
                <span aria-hidden="true">03</span>
              </div>
              <p className="alpha-label alpha-stack-caption">
                CONNECTED BY CONTEXT. NEVER BY ASSUMPTION.
              </p>
            </div>
          </div>
        </section>
        <section className="alpha-evidence alpha-shell">
          <div className="alpha-section-intro" data-alpha-reveal>
            <p className="alpha-label">03 / THE FINE PRINT IS THE POINT</p>
            <h2>
              Confidence needs
              <br />
              <em>something underneath.</em>
            </h2>
            <p>
              Clear boundaries make useful records. Anvilmark keeps these
              distinctions visible, even when the answer is “we don’t know yet.”
            </p>
          </div>
          <div className="alpha-principles">
            {[
              [
                "A check is not a review.",
                "Passing tests and a person accepting the work are different events. Keep both.",
              ],
              [
                "A configured model is not a verified identity.",
                "Record what was configured and what the tool reported. Leave the limits visible.",
              ],
              [
                "An estimate is not a bill.",
                "API-rate estimates, subscription allowances and measured charges have different meanings.",
              ],
              [
                "Your repository stays yours.",
                "The development workflow runs locally. You bring your agent and choose what to share.",
              ],
            ].map(([title, body], index) => (
              <article key={title} data-alpha-reveal>
                <span className="alpha-label">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span aria-hidden="true">↗</span>
              </article>
            ))}
          </div>
        </section>
        <section className="alpha-research-band alpha-shell" data-alpha-reveal>
          <div>
            <p className="alpha-label">A USEFUL PLACE TO LOOK</p>
            <h2>
              Research the options.
              <br />
              Keep the sources.
            </h2>
            <p>
              Explore model offers, prices and public rankings. They’re inputs
              to a decision, with their dates and limitations attached.
            </p>
          </div>
          <Link
            className="alpha-circle-link"
            href="/models"
            aria-label="Explore model research"
          >
            <span>
              Explore
              <br />
              model research
            </span>
            <span aria-hidden="true">↗</span>
          </Link>
        </section>
        <section className="alpha-closing alpha-shell">
          <p className="alpha-label">MAKE THE NEXT CHOICE A LITTLE BETTER.</p>
          <h2>
            Your tools.
            <br />
            Your judgment.
            <br />
            <em>A better record.</em>
          </h2>
          <div>
            <Link className="alpha-button" href="/start">
              Start locally <span aria-hidden="true">↗</span>
            </Link>
            <a
              className="alpha-text-link"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Explore the source ↗
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p>
              Version Alpha. Local development tooling is available.
              <br />
              The browser is a read-only companion, not an agent runner.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
      <AlphaMotion />
    </div>
  );
}
