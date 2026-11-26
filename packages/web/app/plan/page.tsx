import type { Metadata } from "next";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { Planner } from "./planner";
import "./planner.css";

export const metadata: Metadata = { title: "Plan a change" };
export const dynamic = "force-dynamic";

export default function PlanningPage() {
  return (
    <div className="alpha alpha-page">
      <SiteHeader />
      <main id="main" className="alpha-shell planning">
        <header className="planning-heading">
          <h1>Plan a change.</h1>
          <p>
            Turn a rough idea into architecture decisions and a task-by-task
            plan for your coding agent.
          </p>
        </header>
        <Planner
          configured={Boolean(process.env.ANVILMARK_PLANNER_ENDPOINT)}
          serverGemini={Boolean(process.env.ANVILMARK_GEMINI_API_KEY?.trim())}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
