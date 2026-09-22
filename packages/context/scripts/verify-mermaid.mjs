// Parse generated Mermaid with the real Mermaid parser and report what it read.
//
// Mermaid and jsdom are NOT dependencies of this repository. Install them
// anywhere outside the workspace and point ANVILMARK_MERMAID_NODE_MODULES at
// that node_modules directory, e.g.:
//   npm install --prefix /tmp/mermaid-check mermaid@11.12.0 jsdom@26.1.0
//   ANVILMARK_MERMAID_NODE_MODULES=/tmp/mermaid-check/node_modules \
//     node packages/context/scripts/verify-mermaid.mjs view.mmd
//
// Prints one JSON object per file: the diagram type, every vertex id and its
// decoded label text, every edge and its decoded label text, and any parse
// error. Exits 1 if any file fails to parse.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const modules = process.env.ANVILMARK_MERMAID_NODE_MODULES;
if (!modules) {
  console.error(
    "set ANVILMARK_MERMAID_NODE_MODULES to a node_modules directory containing mermaid and jsdom",
  );
  process.exit(2);
}
const require = createRequire(join(modules, "noop.js"));
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const mermaidEntry = pathToFileURL(require.resolve("mermaid")).href;
const { default: mermaid } = await import(mermaidEntry);
mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

// Mermaid's parser stores "#NNN;" label entities as internal placeholders
// ("\ufb02\u00b0\u00b0NNN\u00b6\u00df") and turns them into HTML character references
// when rendering. Apply the same decoding so the report shows the literal text a
// reader would see.
const NAMED = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  nbsp: "\u00a0",
};
const decode = (text) =>
  String(text ?? "")
    .replace(/\ufb02\u00b0\u00b0(\d+)\u00b6\u00df/g, (_, code) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(
      /\ufb02\u00b0(\w+)\u00b6\u00df/g,
      (match, name) => NAMED[name] ?? match,
    );

let failed = 0;
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, "utf8");
  try {
    await mermaid.parse(text);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(text);
    const db = diagram.db;
    const vertices = db.getVertices();
    const entries =
      vertices instanceof Map
        ? [...vertices.values()]
        : Object.values(vertices);
    console.log(
      JSON.stringify({
        file,
        ok: true,
        type: diagram.type,
        vertices: entries.map((vertex) => ({
          id: vertex.id,
          text: decode(vertex.text),
        })),
        edges: db.getEdges().map((edge) => ({
          start: edge.start,
          end: edge.end,
          type: edge.type,
          stroke: edge.stroke,
          text: decode(edge.text),
        })),
        subgraphs: db.getSubGraphs().map((subgraph) => ({
          id: subgraph.id,
          title: decode(subgraph.title),
          nodes: subgraph.nodes,
        })),
      }),
    );
  } catch (error) {
    failed += 1;
    console.log(
      JSON.stringify({
        file,
        ok: false,
        error: String(error?.message ?? error),
      }),
    );
  }
}
process.exit(failed === 0 ? 0 : 1);
