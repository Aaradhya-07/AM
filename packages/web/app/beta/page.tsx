import type { Metadata, Viewport } from "next";

import { BackgroundPixelStars } from "../../components/ui/background-pixel-stars";
import { getSelfHostedPlannerAccess } from "../../lib/planner-access";
import { getCatalogFreshness } from "../../lib/routing-catalog";
import { listSelfHostedModels } from "../../lib/self-hosted-models";

import { SiteHeader } from "../components/site-header";
import { BetaPrompt } from "./prompt";
import styles from "./beta.module.css";

export const metadata: Metadata = { title: "New plan · AnvilMark Beta" };
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};
export const dynamic = "force-dynamic";

export default async function BetaPage() {
  const access = await getSelfHostedPlannerAccess();
  const selfHostedModels = access ? await listSelfHostedModels(access.token) : [];
  const catalogFreshness = getCatalogFreshness();
  return (
    <div className={styles.page}>
      <BackgroundPixelStars />
      <SiteHeader tone="dark" />
      <BetaPrompt
        configured={Boolean(access)}
        configuredModel={
          selfHostedModels[0]?.id ??
          process.env.ANVILMARK_PLANNER_MODEL?.trim() ??
          ""
        }
        selfHostedModels={selfHostedModels}
        serverGemini={Boolean(process.env.ANVILMARK_GEMINI_API_KEY?.trim())}
        serverOpenAI={Boolean(process.env.ANVILMARK_OPENAI_API_KEY?.trim())}
        catalogFreshness={catalogFreshness}
      />
    </div>
  );
}
