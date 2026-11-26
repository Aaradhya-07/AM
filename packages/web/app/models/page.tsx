import type { Metadata } from "next";

import { SessionSurface } from "../components/session-surface";
import { SiteFooter } from "../components/site-footer";
import { ModelExplorer } from "./ModelExplorer";
import { readModelCatalog } from "../../lib/model-catalog-db";

import "./model-atlas.css";

export const metadata: Metadata = {
  title: "Model research",
  description:
    "Search and compare thousands of real AI model offers by price, context, capabilities, and source.",
};

// Read the local snapshot for the first response so the directory is useful
// immediately, even if the browser has not loaded its client scripts yet.
export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const catalog = readModelCatalog();
  return (
    <SessionSurface>
      <a className="model-atlas-skip" href="#main">
        Skip to content
      </a>
      <div id="main" tabIndex={-1}>
        <ModelExplorer initialCatalog={catalog} />
      </div>
      <SiteFooter />
    </SessionSurface>
  );
}
