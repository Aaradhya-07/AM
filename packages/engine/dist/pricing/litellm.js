export const LITELLM_PRICING_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
export async function loadPricingCatalog() {
    // TODO(engine): fetch, validate, and cache LITELLM_PRICING_URL.
    // Network access is intentionally absent from the scaffold.
    return null;
}
