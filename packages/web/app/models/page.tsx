import type { Metadata, Viewport } from "next";

import { ModelExplorer } from "./ModelExplorer";
import { readModelCatalog } from "../../lib/model-catalog-db";

import "./model-atlas.css";

export const metadata: Metadata = {
  title: { absolute: "Model Atlas" },
  description:
    "Search and compare thousands of real AI model offers by price, context, capabilities, and source.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f5f6f7",
};

// Read the local snapshot for the first response so the directory is useful
// immediately, even if the browser has not loaded its client scripts yet.
export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const catalog = readModelCatalog();
  return (
    <>
      <a className="model-atlas-skip" href="#main">
        Skip to content
      </a>
      <div id="main" tabIndex={-1}>
        <ModelExplorer initialCatalog={catalog} />
      </div>
    </>
  );
}
