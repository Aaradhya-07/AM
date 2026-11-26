import type { Metadata, Viewport } from "next";

import { BackgroundPixelStars } from "../../components/ui/background-pixel-stars";

import { SiteHeader } from "../components/site-header";
import { BetaPrompt } from "./prompt";
import styles from "./beta.module.css";

export const metadata: Metadata = { title: "New plan · AnvilMark Beta" };
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};
export const dynamic = "force-dynamic";

export default function BetaPage() {
  return (
    <div className={styles.page}>
      <BackgroundPixelStars />
      <SiteHeader tone="dark" />
      <main className={styles.main}>
        <h1>
          What are you
          <br className={styles.break} /> building?
        </h1>
        <p>
          Start with an idea. We’ll turn it into a plan your coding agent can
          use.
        </p>
        <BetaPrompt
          configured={Boolean(process.env.ANVILMARK_PLANNER_ENDPOINT)}
        />
      </main>
    </div>
  );
}
