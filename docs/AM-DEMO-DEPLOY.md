# AM browser demo and deployment

Updated: 2026-10-14

## What the new entry does

The site root is the landing page, with **Create a contract** leading to `/demo`. The editor starts with empty project fields; the support triage sample is optional. A visitor can record one project idea, one AI workload, an input data boundary, a draft architecture path, optional usage/budget/quality target, and two or more candidate model paths. Four sourced model starters fill exact model IDs and deployment details; a custom model remains possible. The comparison shows declared deployment facts and missing evidence. An optional lookup fetches published evaluations for an exact Hugging Face `publisher/model` ID through a read-only website endpoint. **It does not rank, measure, select, or approve a model.** Download creates a draft.5 JSON contract in the browser; draft form data is not sent to the website server. A lookup sends only the requested public model ID.

The previous `/overview` path redirects to the landing page. The primary navigation is Home, Getting started, Create contract, and Review bundle. Studio starts with an empty import state; Atlas opens only when a visitor selects the example. The Atlas playground and optional dashboard are separate from contract authoring. `/login` is the sign-in route for an account-backed dashboard when Supabase is configured.

## Demo walkthrough

1. Open the AM site and choose **Create a contract** (or go directly to `/demo`). Enter a project idea, or select **Load support triage example** to inspect sample inputs.
2. Name one AI workload, select its type, and state whether input data must stay local. Choose local processing, local redaction before remote processing, or direct remote processing. The last path is blocked when the input is marked local-only. Redaction creates a separate draft preprocessing workload and remains unverified.
3. Select two sourced model starters or enter exact custom model IDs. The fit note uses the workload type and selected data-flow path; it is a planning aid, not measured quality. For a Hugging Face model, click **Check Hugging Face evaluations**. Note the source, retrieval date, published scores, privacy question, and evidence still needed for each.
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

## Account sign-in

1. For a new Supabase project, run [`packages/web/supabase/schema.sql`](../packages/web/supabase/schema.sql) in the Supabase SQL Editor to create the account and project tables.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel and in `packages/web/.env.local` for local development. Copy both values from the Supabase project's Connect dialog. Existing installations can still use `NEXT_PUBLIC_SUPABASE_ANON_KEY` with a legacy `anon` key. Keep Supabase secret and service-role keys out of public environment variables.
3. In Supabase Auth URL Configuration, set **Site URL** to `http://localhost:3000` for local development or to the deployed AnvilMark origin for production. Add the matching callback URLs to **Redirect URLs**. Replace `https://<site>` with the deployed origin when it is available and change `3000` if the local port differs.

   ```text
   https://<site>/auth/callback
   https://<site>/auth/callback?next=%2Fworkspace
   http://localhost:3000/auth/callback
   http://localhost:3000/auth/callback?next=%2Fworkspace
   ```

4. Create a **Web application** OAuth client in Google Auth Platform. Add the app origin under **Authorized JavaScript origins**. Add the callback shown in the Supabase Google provider settings as an **Authorized redirect URI**. It normally has the form `https://<supabase-project-ref>.supabase.co/auth/v1/callback`. Enter the Google client ID and client secret in the Supabase Google provider settings and enable the provider.
5. Enable the Supabase Email provider for password sign-in. If email confirmation is enabled, configure SMTP for signup outside the Supabase project team. Open `/login` to check that sign-in returns to `/workspace`.

The public draft and local bundle review work without a Supabase account.

Supabase references: [Google OAuth setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).

## Current boundary

The browser comparison uses user-entered candidate details, four source-linked starter descriptions, and optional live Hugging Face published evaluations. Starter descriptions do not establish model quality for a user's data. The lookup has limited coverage and does not import evidence into the contract. Artificial Analysis research and the local snapshot catalog remain CLI-only through `anvilmark quality`. The editor exports a draft architecture graph; implementation checks, real workload evaluations, source-backed restrictions, approval, generated architecture views, and repository conformance remain local CLI steps. The hosted site needs a deliberate sync or local companion design before it can show the same live contract and MCP state.
