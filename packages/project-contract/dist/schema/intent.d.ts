import { z } from "zod/v4";
export declare const OutcomeTargetSchema: z.ZodObject<{
    id: z.ZodString;
    measure: z.ZodString;
    target: z.ZodString;
}, z.core.$strict>;
export type OutcomeTarget = z.infer<typeof OutcomeTargetSchema>;
export declare const IntentSchema: z.ZodObject<{
    summary: z.ZodString;
    users: z.ZodDefault<z.ZodArray<z.ZodString>>;
    outcomes: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        measure: z.ZodString;
        target: z.ZodString;
    }, z.core.$strict>>>;
    non_goals: z.ZodDefault<z.ZodArray<z.ZodString>>;
    unresolved_questions: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type Intent = z.infer<typeof IntentSchema>;
//# sourceMappingURL=intent.d.ts.map