export declare const LITELLM_PRICING_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export interface ModelPricing {
    readonly inputCostPerToken: number | null;
    readonly outputCostPerToken: number | null;
    readonly maxInputTokens: number | null;
    readonly maxOutputTokens: number | null;
}
export type ModelPricingCatalog = Readonly<Record<string, ModelPricing>>;
export declare function loadPricingCatalog(): Promise<ModelPricingCatalog | null>;
//# sourceMappingURL=litellm.d.ts.map