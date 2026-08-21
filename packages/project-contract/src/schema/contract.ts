import { z } from "zod/v4";

import { PROJECT_SCHEMA_ID, PROJECT_SCHEMA_VERSION } from "../version.js";
import { ApprovalSchema } from "./approvals.js";
import { ArchitectureSchema } from "./architecture.js";
import { RepositoryBindingSchema } from "./bindings.js";
import { CandidateSchema } from "./candidates.js";
import { ConformanceRuleSchema } from "./conformance.js";
import { ConstraintSchema } from "./constraints.js";
import { DecisionSchema } from "./decisions.js";
import { EvidencePolicySchema, EvidenceRecordSchema } from "./evidence.js";
import { IntegrationSchema } from "./integrations.js";
import { IntentSchema } from "./intent.js";
import { ProjectSchema } from "./project.js";
import { RemoteIntelligencePolicySchema } from "./remote.js";
import { ResourcesSchema } from "./resources.js";
import { WorkloadSchema } from "./workloads.js";

/**
 * The project contract.
 *
 * Strict throughout: unknown fields are rejected during the draft phase so
 * that spelling mistakes and agent-generated inventions surface immediately
 * rather than being silently discarded. A namespaced extension mechanism is a
 * later, deliberate decision.
 *
 * `evidence_refs` holds the evidence RECORDS themselves. The name is the
 * ratified top-level key from doc 03 section 3 and is kept as authored.
 */
export const ProjectContractSchema = z.strictObject({
  schema: z.literal(PROJECT_SCHEMA_ID),
  schema_version: z.literal(PROJECT_SCHEMA_VERSION),
  project: ProjectSchema,
  intent: IntentSchema,
  constraints: z.array(ConstraintSchema).default([]),
  workloads: z.array(WorkloadSchema).default([]),
  resources: ResourcesSchema.prefault({}),
  evidence_policy: EvidencePolicySchema.prefault({}),
  candidates: z.array(CandidateSchema).default([]),
  evidence_refs: z.array(EvidenceRecordSchema).default([]),
  decisions: z.array(DecisionSchema).default([]),
  architecture: ArchitectureSchema,
  repository_bindings: z.array(RepositoryBindingSchema).default([]),
  conformance_rules: z.array(ConformanceRuleSchema).default([]),
  integrations: z.array(IntegrationSchema).default([]),
  remote_intelligence_policy: RemoteIntelligencePolicySchema.prefault({}),
  approvals: z.array(ApprovalSchema).default([]),
});

export type ProjectContract = z.infer<typeof ProjectContractSchema>;
