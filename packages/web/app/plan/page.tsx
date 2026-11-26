import type { Metadata } from "next";
import { listSelfHostedModels } from "../../lib/self-hosted-models";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { Planner } from "./planner";
import "./planner.css";

export const metadata: Metadata = { title: "Plan a change" };
export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  const configured = Boolean(process.env.ANVILMARK_PLANNER_ENDPOINT?.trim());
  const selfHostedModels = configured ? await listSelfHostedModels() : [];
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
          configured={configured}
          configuredModel={
            selfHostedModels[0]?.id ??
            process.env.ANVILMARK_PLANNER_MODEL?.trim() ??
            ""
          }
          serverGemini={Boolean(process.env.ANVILMARK_GEMINI_API_KEY?.trim())}
        />
      </main>
      <SiteFooter />
    </div>
  );
}
