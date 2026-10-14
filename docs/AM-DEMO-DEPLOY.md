# AM browser demo and deployment

Updated: 2026-10-14

## What the new entry does

The site root is the landing page, with **Create a contract** leading to `/demo`. A visitor can record one project idea, one workload, input data boundary, optional usage/budget/quality target, and two or more candidate model paths. The side-by-side comparison shows declared deployment facts and missing evidence. An optional lookup fetches published evaluations for an exact Hugging Face `publisher/model` ID through a read-only website endpoint. **It does not rank, measure, select, or approve a model.** Download creates a draft.5 JSON contract in the browser; draft form data is not sent to the website server. A lookup sends only the requested public model ID.

The previous `/overview` path redirects to the landing page. Studio still opens an exported review bundle. The dashboard and Atlas playground are separate early surfaces and are not the contract authoring flow. Public sign-in is removed and `/login` redirects to the contract demo while the optional dashboard authentication is unconfigured.

## Demo walkthrough

1. Open the AM site and choose **Create a contract** (or go directly to `/demo`). The prefilled Support Triage example is illustrative; edit it to fit the project.
2. Enter the workload and select whether input data must stay local.
3. Enter two candidate names and their deployment modes. For a Hugging Face model, use its exact `publisher/model` ID and click **Check Hugging Face evaluations**. Note the source, retrieval date, published scores, privacy question, and evidence still needed for each.
4. Click **Download draft contract**. The file is validated against the project-contract schema and has `draft` state, `unevaluated` candidates, no decision, and no approval.
5. In a local project directory with the CLI set up, run `anvilmark init --from-contract /path/to/downloaded-file.anvilmark.json`, then `anvilmark compare`. Import performs the full contract validation.
6. Add actual evidence and finish human review/approval through the CLI. `anvilmark generate` produces architecture and agent context; `anvilmark export` produces the Studio bundle.
7. Point `anvilmark-project-mcp` at the same local project directory for an agent. It exposes read-only project context and checks. It cannot approve or edit the contract, and the hosted site cannot directly access a local stdio MCP server. See [MCP setup](../packages/mcp/README.md).

## Build locally

From the repository root, with Node.js 24 and pnpm available:

```sh
pnpm install --frozen-lockfile
pnpm --filter @anvilmark/web build
pnpm --filter @anvilmark/web start
```

The website `build` script first builds workspace dependencies, then runs Next.js. The demo route is prerendered; contract construction runs in the browser.

## New Vercel project

Create a **new** Vercel project from the AM Git repository. In the import screen select `packages/web` as the Root Directory, Next.js as the framework, and Node.js 24. Enable **Include source files outside of the Root Directory in the Build Step**, because the site uses workspace packages from `packages/`. Keep the build command as the package's `pnpm run build` and the output directory at the framework default. Set `NEXT_PUBLIC_SITE_URL` to the new production URL after it is known; this is used for social metadata. Supabase variables are optional for the draft demo, and no account is required to use it.

Vercel project slugs must be lowercase, so `am` is the natural project name even if the product is displayed as **AM**. The new deployment must contain these repository changes in its connected branch. This document does not change or redeploy the old `anvilmark.vercel.app` project.

Vercel references: [monorepo setup](https://vercel.com/docs/monorepos), [outside-root source setting](https://vercel.com/docs/monorepos/monorepo-faq), [project naming](https://vercel.com/docs/project-configuration/general-settings).

## Current boundary

The browser comparison uses user-entered candidate details plus optional live Hugging Face published evaluations. The lookup has limited coverage and does not import evidence into the contract. Artificial Analysis research and the local snapshot catalog remain CLI-only through `anvilmark quality`. Real workload evaluations, restrictions mapping, approval, architecture generation, and repository conformance remain local CLI steps. The hosted site needs a deliberate sync or local companion design before it can show the same live contract and MCP state.
