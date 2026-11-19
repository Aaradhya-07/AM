import type { Metadata, Viewport } from "next";

import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { ModelExplorer } from "./ModelExplorer";
import { readModelCatalog } from "../../lib/model-catalog-db";

import "./model-atlas.css";

export const metadata: Metadata = {
  title: "Model research",
  description:
    "Search and compare thousands of real AI model offers by price, context, capabilities, and source.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f3f0e7",
};

// Read the local snapshot for the first response so the directory is useful
// immediately, even if the browser has not loaded its client scripts yet.
export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const catalog = readModelCatalog();
  return (
    <div className="alpha alpha-page">
      <SiteHeader />
      <a className="model-atlas-skip" href="#main">
        Skip to content
      </a>
      <div id="main" tabIndex={-1}>
        <ModelExplorer initialCatalog={catalog} />
      </div>
      <SiteFooter />
    </div>
  );
}
