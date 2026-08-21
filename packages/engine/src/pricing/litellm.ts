export const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export interface ModelPricing {
  readonly inputCostPerToken: number | null;
  readonly outputCostPerToken: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
}

export type ModelPricingCatalog = Readonly<Record<string, ModelPricing>>;

export async function loadPricingCatalog(): Promise<ModelPricingCatalog | null> {
  // TODO(engine): fetch, validate, and cache LITELLM_PRICING_URL.
  // Network access is intentionally absent from the scaffold.
  return null;
}
