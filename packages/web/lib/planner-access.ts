import { headers } from "next/headers";

export async function getSelfHostedPlannerAccess(): Promise<{
  endpoint: string;
  token?: string;
} | null> {
  const endpoint = process.env.ANVILMARK_PLANNER_ENDPOINT?.trim();
  if (!endpoint) return null;
  if (process.env.ANVILMARK_PLANNER_AUTH !== "vercel-oidc") return { endpoint };
  if (URL.parse(endpoint)?.protocol !== "https:") return null;

  const token = (await headers()).get("x-vercel-oidc-token");
  return token ? { endpoint, token } : null;
}
