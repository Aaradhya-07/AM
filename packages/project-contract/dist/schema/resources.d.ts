import { z } from "zod/v4";
export declare const AcceleratorSchema: z.ZodObject<{
    vendor: z.ZodString;
    model: z.ZodString;
    vram_gb: z.ZodNumber;
    count: z.ZodDefault<z.ZodInt>;
}, z.core.$strict>;
export type Accelerator = z.infer<typeof AcceleratorSchema>;
export declare const CpuSchema: z.ZodObject<{
    cores: z.ZodInt;
    model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
/**
 * How this hardware entry came to be known. This is the load-bearing
 * distinction from doc 06 section 6 and section 8: a machine the user
 * DECLARES they own or plan to buy is a different subject from a machine
 * ANVILMARK DETECTED while running. Detected hardware must never silently
 * replace a declared target, so the two are separate entries with separate
 * ids rather than one mutable record.
 */
export declare const HardwareEvidenceKindSchema: z.ZodEnum<{
    deterministic_observation: "deterministic_observation";
    user_declared: "user_declared";
}>;
export type HardwareEvidenceKind = z.infer<typeof HardwareEvidenceKindSchema>;
export declare const HardwareSchema: z.ZodObject<{
    id: z.ZodString;
    evidence_kind: z.ZodEnum<{
        deterministic_observation: "deterministic_observation";
        user_declared: "user_declared";
    }>;
    cpu: z.ZodObject<{
        cores: z.ZodInt;
        model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    ram_gb: z.ZodNumber;
    accelerators: z.ZodDefault<z.ZodArray<z.ZodObject<{
        vendor: z.ZodString;
        model: z.ZodString;
        vram_gb: z.ZodNumber;
        count: z.ZodDefault<z.ZodInt>;
    }, z.core.$strict>>>;
    operating_system: z.ZodEnum<{
        linux: "linux";
        macos: "macos";
        windows: "windows";
        other: "other";
    }>;
    evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type Hardware = z.infer<typeof HardwareSchema>;
export declare const BudgetSchema: z.ZodObject<{
    currency: z.ZodString;
    period: z.ZodEnum<{
        day: "day";
        month: "month";
        year: "year";
    }>;
    amount: z.ZodNumber;
    scope: z.ZodString;
}, z.core.$strict>;
export type Budget = z.infer<typeof BudgetSchema>;
export declare const ResourcesSchema: z.ZodObject<{
    hardware: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        evidence_kind: z.ZodEnum<{
            deterministic_observation: "deterministic_observation";
            user_declared: "user_declared";
        }>;
        cpu: z.ZodObject<{
            cores: z.ZodInt;
            model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>;
        ram_gb: z.ZodNumber;
        accelerators: z.ZodDefault<z.ZodArray<z.ZodObject<{
            vendor: z.ZodString;
            model: z.ZodString;
            vram_gb: z.ZodNumber;
            count: z.ZodDefault<z.ZodInt>;
        }, z.core.$strict>>>;
        operating_system: z.ZodEnum<{
            linux: "linux";
            macos: "macos";
            windows: "windows";
            other: "other";
        }>;
        evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>>;
    budgets: z.ZodDefault<z.ZodArray<z.ZodObject<{
        currency: z.ZodString;
        period: z.ZodEnum<{
            day: "day";
            month: "month";
            year: "year";
        }>;
        amount: z.ZodNumber;
        scope: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type Resources = z.infer<typeof ResourcesSchema>;
//# sourceMappingURL=resources.d.ts.map