import { loadFixture } from "@anvilmark/contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FindingsTable } from "../app/findings-table";

describe("fixture findings table", () => {
  it("renders validated fixture findings", async () => {
    const fixture = await loadFixture("saas-support");
    const html = renderToStaticMarkup(
      createElement(FindingsTable, { result: fixture }),
    );

    expect(html).toContain("Right-size the ticket classifier model");
    expect(html).toContain("Monthly savings");
  });
});
