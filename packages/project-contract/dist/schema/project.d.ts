import { z } from "zod/v4";
/**
 * Constraint domains. These double as the vocabulary of `priority_order`,
 * so the user's declared tie-breaking order is checked against real domains
 * rather than free text.
 */
export declare const ConstraintDomainSchema: z.ZodEnum<{
    functionality: "functionality";
    quality: "quality";
    cost: "cost";
    tokens: "tokens";
    latency: "latency";
    throughput: "throughput";
    privacy: "privacy";
    residency: "residency";
    provider_policy: "provider_policy";
    licensing: "licensing";
    hardware: "hardware";
    availability: "availability";
    operability: "operability";
    repository_policy: "repository_policy";
}>;
export type ConstraintDomain = z.infer<typeof ConstraintDomainSchema>;
export declare const ProjectStateSchema: z.ZodEnum<{
    draft: "draft";
    active: "active";
    superseded: "superseded";
    archived: "archived";
}>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
/**
 * An owner is a local identity or role. No email address is required, and
 * owners are default-denied to remote intelligence.
 */
export declare const OwnerSchema: z.ZodObject<{
    ref: z.ZodString;
    role: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type Owner = z.infer<typeof OwnerSchema>;
export declare const ProjectSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    created_at: z.ZodISODateTime;
    updated_at: z.ZodISODateTime;
    contract_revision: z.ZodInt;
    state: z.ZodEnum<{
        draft: "draft";
        active: "active";
        superseded: "superseded";
        archived: "archived";
    }>;
    repository_roots: z.ZodDefault<z.ZodArray<z.ZodString>>;
    owners: z.ZodDefault<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        role: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>>;
    priority_order: z.ZodArray<z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>>;
}, z.core.$strict>;
export type Project = z.infer<typeof ProjectSchema>;
//# sourceMappingURL=project.d.ts.map