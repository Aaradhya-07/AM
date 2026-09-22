import { describe, expect, it } from "vitest";

import { hardwareCapabilitiesMatch } from "@anvilmark/project-contract";
import type { Hardware } from "@anvilmark/project-contract";

/**
 * Reproductions for the hardware-matching blockers. A fit result depends on
 * more than the accelerator, and name comparison by containment is unsound.
 */
function hardware(overrides: Partial<Hardware> = {}): Hardware {
  return {
    id: "hardware.example",
    evidence_kind: "user_declared",
    cpu: { cores: 16, model: null },
    ram_gb: 64,
    accelerators: [
      { vendor: "nvidia", model: "RTX 4090", vram_gb: 24, count: 1 },
    ],
    backend: "cuda",
    operating_system: "linux",
    evidence_refs: [],
    ...overrides,
  } as Hardware;
}

describe("3. hardware capability matching", () => {
  it("matches a detected long name against a declared short one", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      accelerators: [
        {
          vendor: "nvidia",
          model: "NVIDIA GeForce RTX 4090",
          vram_gb: 24,
          count: 1,
        },
      ],
    });

    expect(hardwareCapabilitiesMatch(declared, detected).matches).toBe(true);
  });

  it("does not match an RTX 4090 Ti against a declared RTX 4090", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      accelerators: [
        {
          vendor: "nvidia",
          model: "NVIDIA GeForce RTX 4090 Ti",
          vram_gb: 24,
          count: 1,
        },
      ],
    });

    // A Ti is a different card. Containment cannot tell them apart.
    expect(hardwareCapabilitiesMatch(declared, detected).matches).toBe(false);
  });

  it("does not match a SUPER variant against a declared base model", () => {
    const declared = hardware({
      accelerators: [
        { vendor: "nvidia", model: "RTX 4070", vram_gb: 12, count: 1 },
      ],
    });
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      accelerators: [
        {
          vendor: "nvidia",
          model: "NVIDIA GeForce RTX 4070 SUPER",
          vram_gb: 12,
          count: 1,
        },
      ],
    });

    expect(hardwareCapabilitiesMatch(declared, detected).matches).toBe(false);
  });

  it("rejects insufficient detected RAM", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      ram_gb: 16,
    });

    // A fit estimate depends on system memory, not only VRAM.
    const result = hardwareCapabilitiesMatch(declared, detected);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("RAM");
  });

  it("rejects insufficient detected CPU cores", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      cpu: { cores: 4, model: null },
    });

    const result = hardwareCapabilitiesMatch(declared, detected);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("CPU");
  });

  it("rejects a different operating system", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      operating_system: "macos",
    });

    const result = hardwareCapabilitiesMatch(declared, detected);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("operating system");
  });

  it("rejects a differing accelerator count expressed through count", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      accelerators: [
        {
          vendor: "nvidia",
          model: "NVIDIA GeForce RTX 4090",
          vram_gb: 24,
          count: 2,
        },
      ],
    });

    expect(hardwareCapabilitiesMatch(declared, detected).matches).toBe(false);
  });

  it("does not accept a stronger machine as evidence about a weaker target", () => {
    const declared = hardware({ ram_gb: 32, cpu: { cores: 8, model: null } });
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      ram_gb: 64,
      cpu: { cores: 16, model: null },
    });

    // A 64 GB / 16-core result says nothing about how a 32 GB / 8-core machine
    // behaves: fit, achievable context and throughput all differ.
    const result = hardwareCapabilitiesMatch(declared, detected);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("does not transfer");
  });

  it("accepts an identical machine", () => {
    const declared = hardware();
    const detected = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      accelerators: [
        {
          vendor: "nvidia",
          model: "NVIDIA GeForce RTX 4090",
          vram_gb: 24,
          count: 1,
        },
      ],
    });

    expect(hardwareCapabilitiesMatch(declared, detected).matches).toBe(true);
  });

  it("compares the CPU model when the declared target names one", () => {
    const declared = hardware({
      cpu: { cores: 16, model: "AMD Ryzen 9 7950X" },
    });
    const same = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      cpu: { cores: 16, model: "AMD Ryzen 9 7950X" },
    });
    const other = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      cpu: { cores: 16, model: "Intel Core i9-13900K" },
    });
    const unknownCpu = hardware({
      id: "hardware.detected",
      evidence_kind: "deterministic_observation",
      cpu: { cores: 16, model: null },
    });

    expect(hardwareCapabilitiesMatch(declared, same).matches).toBe(true);
    expect(hardwareCapabilitiesMatch(declared, other).matches).toBe(false);
    // Incomparable is not a match.
    expect(hardwareCapabilitiesMatch(declared, unknownCpu).matches).toBe(false);
  });
});
