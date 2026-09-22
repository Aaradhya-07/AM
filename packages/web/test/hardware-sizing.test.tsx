// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySizingArtifact } from "@anvilmark/hardware-sizing";
import { HardwareSizingCockpit } from "../app/components/HardwareSizingCockpit";

let container: HTMLDivElement;
let root: Root;
const hashText = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLSelectElement)
  )
    throw new Error(`Missing field: ${label}`);
  return element;
}

async function set(label: string, value: string) {
  const element = field(label);
  await act(async () => {
    // Use the native setter so React observes a user edit, not a tracked assignment.
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

function button(label: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}

async function budget() {
  await set("Allocation limit GiB", "24");
  await set("Reserved memory GiB", "2");
  await set("Runtime overhead GiB", "1");
  await set("Allocator allowance GiB", "0.25");
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sizing-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HardwareSizingCockpit));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hardware sizing interactions", () => {
  it("keeps missing assumptions unknown, then recalculates context and precision", async () => {
    expect(
      container.querySelector('[data-testid="sizing-total"]')?.textContent,
    ).toBe("Unknown");
    await budget();
    expect(container.textContent).toContain("Estimated within your budget");
    expect(
      container.querySelector('[data-testid="sizing-total"]')?.textContent,
    ).toBe("15.65 GiB");
    await set("Retained context tokens", "32768");
    await set("Concurrent sequences", "2");
    expect(
      container.querySelector('[data-testid="sizing-total"]')?.textContent,
    ).toBe("18.94 GiB");
    await set("KV cache precision", "fp32");
    expect(container.textContent).toContain("Estimated over your budget");
    expect(
      container.querySelector('[data-testid="sizing-total"]')?.textContent,
    ).toBe("22.44 GiB");
    expect(container.textContent).toContain("Performance unverified");
  });

  it("preserves MoE context and keeps quantization metadata unknown until supplied", async () => {
    await budget();
    await set("Retained context tokens", "32768");
    await set("Concurrent sequences", "2");
    await set("Model artifact", "mistralai/Mixtral-8x7B-Instruct-v0.1");
    await set("Weight storage", "nominal_int4");
    expect(field("Retained context tokens").value).toBe("32768");
    expect(container.textContent).toContain("All experts stay resident");
    expect(container.textContent).toContain("Estimated over your budget");
    expect(
      container.querySelector('[data-testid="sizing-total"]')?.textContent,
    ).toBe("Unknown");
    await set("Memory pool", "unified_memory");
    await set("Installed capacity GiB", "64");
    await set("Allocation limit GiB", "48");
    await set("Reserved memory GiB", "4");
    await set("Quantization allowance GiB", "1");
    expect(
      container.querySelector('[data-testid="sizing-headroom"]')?.textContent,
    ).toBe("12 GiB");
  });

  it("invalidates old results and disables exports for invalid inputs", async () => {
    await budget();
    await set("Concurrent sequences", "0");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("Export sizing proposal").disabled).toBe(true);
    expect(container.querySelector('[data-testid="sizing-total"]')).toBeNull();
    await click("Reset scenario");
    expect(button("Export sizing proposal").disabled).toBe(false);
    expect(field("Concurrent sequences").value).toBe("1");
    expect(field("Allocation limit GiB").value).toBe("");
  });

  it("exports verifiable browser JSON and clears it on any edit", async () => {
    await budget();
    await click("Export sizing proposal");
    await vi.waitFor(() =>
      expect(
        container.querySelector('textarea[aria-label="Sizing proposal JSON"]'),
      ).not.toBeNull(),
    );
    const json = (container.querySelector("textarea") as HTMLTextAreaElement)
      .value;
    const result = await verifySizingArtifact(JSON.parse(json), hashText);
    expect(result.ok).toBe(true);
    expect(JSON.parse(json).input.project_binding).toBeNull();
    expect(JSON.parse(json).result.contract_evidence).toBe("unattached");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    await set("Retained context tokens", "8192");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("handles clipboard rejection and supplies an assumption-bearing handoff", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("denied"),
    );
    await click("Copy sizing brief");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Could not copy the brief"),
    );
    await click("Copy sizing brief");
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Sizing brief copied"),
    );
    const brief = vi
      .mocked(navigator.clipboard.writeText)
      .mock.calls.at(-1)![0];
    expect(brief).toContain("no contract evidence is attached");
    expect(brief).toContain(
      "Gap: Runtime/activation/loading overhead has not been budgeted",
    );
    expect(brief).toContain("Input digest: sha256:");
  });

  it("discards an export if inputs change while hashing", async () => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    let release: (() => void) | undefined;
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(
      async (...args) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return original(...args);
      },
    );
    await click("Export sizing proposal");
    expect(button("Preparing…").disabled).toBe(true);
    await set("Retained context tokens", "8192");
    await act(async () => {
      release!();
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Inputs changed during export"),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")).toBeNull();
  });
});

describe("inventory and device controls", () => {
  it("calculates each device independently without pooled headroom", async () => {
    await budget();
    await set("Homogeneous device count", "2");
    expect(container.textContent).toContain("Per-device memory");
    expect(field("Allocation limit GiB").disabled).toBe(true);
    expect(field("Reserved memory GiB").disabled).toBe(true);
    expect(field("Runtime overhead GiB").disabled).toBe(true);
    expect(field("Allocator allowance GiB").disabled).toBe(true);
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toContain("across 2 devices");
    expect(
      container.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).not.toContain("Declared capacity");
    await set("Installed capacity GiB", "32");
    await click("Export sizing proposal");
    await vi.waitFor(() =>
      expect(container.querySelector("textarea")).not.toBeNull(),
    );
    const artifact = JSON.parse(
      (container.querySelector("textarea") as HTMLTextAreaElement).value,
    );
    expect(
      artifact.input.extensions.devices.map(
        (device: { capacity_bytes: number }) => device.capacity_bytes,
      ),
    ).toEqual([32 * 2 ** 30, 32 * 2 ** 30]);
    await click("Copy sizing brief");
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
    expect(
      vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0],
    ).toContain("device-0: 14 layers");
    expect(
      container.querySelector('[data-testid="sizing-headroom"]')?.textContent,
    ).toBe("Unknown");
    await set("device-0 Allocation GiB", "2");
    await set("device-0 Reserve GiB", "0");
    expect(container.textContent).toContain("Estimated over your budget");
    await set("Memory pool", "unified_memory");
    expect(field("Homogeneous device count").value).toBe("1");
    expect(field("Allocation limit GiB").disabled).toBe(false);
  });
  it("rejects oversized and malformed imports without replacing current inputs", async () => {
    const file = field("Import hardware JSON") as HTMLInputElement;
    for (const raw of [
      { size: 1048577, text: async () => "{}" },
      { size: 2, text: async () => "{}" },
    ]) {
      await act(async () => {
        Object.defineProperty(file, "files", {
          configurable: true,
          value: [raw],
        });
        file.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(field("Installed capacity GiB").value).toBe("24");
    }
    expect(container.textContent).toContain("Invalid input");
  });
  it("imports a CLI snapshot as T1 planning inputs and keeps availability separate", async () => {
    const memory = {
      bytes: 16 * 2 ** 30,
      evidence_kind: "deterministic_observation",
      source: "node:os",
    };
    const raw = {
      format: "anvilmark-hardware-probe/2",
      id: "probe.test",
      observed_at: "2026-09-18T00:00:00Z",
      detector_version: "0.2.0-draft.1",
      platform: "macos",
      scope: "host",
      status: "complete",
      cpu: { logical_cores: 8, model: null },
      physical_memory: memory,
      available_memory: null,
      allocation_limit: null,
      availability_expires_at: "2026-09-18T00:00:30Z",
      gpu_inventory: "complete",
      visibility_limited: false,
      devices: [
        {
          id: "device-0",
          vendor: "apple",
          model: "Apple M2",
          backend: "metal",
          memory_kind: "shared",
          installed_memory: null,
          available_memory: null,
          recommended_working_set: null,
        },
      ],
      diagnostics: [],
    };
    const file = field("Import hardware JSON") as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(file, "files", {
        configurable: true,
        value: [{ size: 1024, text: async () => JSON.stringify(raw) }],
      });
      file.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(field("Installed capacity GiB").value).toBe("16");
    expect(field("Allocation limit GiB").value).toBe("");
    expect(container.textContent).toContain("File authenticity unverified");
    await set("Installed capacity GiB", "24");
    expect(container.textContent).toContain("shared system RAM");
    expect(container.textContent).toContain("T1 planning assumptions");
    await click("Reset scenario");
    expect(container.textContent).not.toContain("File authenticity unverified");
  });
});
