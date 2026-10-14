# Web information architecture plan

The site helps a user describe an AI workload, compare candidate deployments, download a draft decision contract, complete evidence and approval with the local CLI, and review an exported bundle. The hosted site does not connect to the local MCP server. Atlas is a synthetic teaching example.

## Primary navigation

1. **Home** (`/`): product purpose and workflow summary.
2. **Getting started** (`/start`): two short paths, one for a user's project and one for a prepared example. Include local CLI and MCP setup here.
3. **Create contract** (`/demo`): the browser draft workflow and its comparison.
4. **Review bundle** (`/studio`): import and inspect a local export. Atlas loads only after an explicit example action.

Keep this order and these names in the desktop header, mobile menu, and footer. Link from the relevant steps to the next action. Home-page anchors remain within the home page, not global navigation items.

## Contextual routes

- `/playground`: the Atlas conformance example and deployment sizing. Reach it from Getting started and example links. Do not frame it as the main project workflow.
- `/dashboard`: optional project console for configured accounts or local projects. Keep the route and its functions, but do not advertise simulated data or authentication as a required first step.
- `/login`: sign-in entry for the optional console. Show configuration or provider errors there.
- `/overview`: legacy redirect to Home. Keep existing Atlas query links working for Studio.

## Implementation

Use the existing header, footer, pages, and Tailwind conventions. Remove duplicate global links and reduce the six-item header to four stable destinations. Make `/start` the concise first-use guide; keep detailed setup below it. Keep Atlas opt-in and clearly marked synthetic. Repair OAuth and session handling without introducing an account requirement for the public draft, example, or review routes. Verify the build, tests, route behavior, and mobile navigation.
