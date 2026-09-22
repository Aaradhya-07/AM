# Releasing the `anvilmark` package

One published package, `anvilmark`, carries all three binaries: `anvilmark`,
`anvilmark-project-mcp` and `anvilmark-mcp`. The workspace packages are bundled
into it, so installing does not pull in the monorepo and no `@anvilmark/*`
package becomes public API by accident.

Only four dependencies stay external, because they are other people's code and
their licences travel with them: `typescript` (the compiler the scanner runs),
`zod`, `js-yaml` and `@modelcontextprotocol/server`.

## Build and verify

```bash
pnpm build:npm
```

That builds the workspace, bundles the three entries into `dist-npm/` and packs
a tarball. Verify it the way a stranger would, from outside the checkout:

```bash
mkdir /tmp/anvilmark-check && cd /tmp/anvilmark-check && npm init -y
npm install /path/to/ANVILMARK/dist-npm/anvilmark-<version>.tgz
./node_modules/.bin/anvilmark inventory /path/to/some/repo
```

A release is only ready when that clean install reproduces what the checkout
does: the inventory reports the same call sites, `anvilmark init` and
`anvilmark scan draft-config` work, and `anvilmark-project-mcp` answers
`tools/list` with JSON-RPC on stdout and diagnostics on stderr.

## Publish

One command, because the failure mode is a split one. Running the build and
the publish as separate lines lets a failed build leave you in the repository
root, where `npm publish` packs the whole repository instead of the package:

```bash
npm whoami            # confirm the intended account
pnpm publish:npm      # builds, packs, and publishes from dist-npm under --tag next
```

To read the file list first:

```bash
pnpm build:npm && cd dist-npm && npm publish --access public --tag next --dry-run
```

Two guards stand behind this. The workspace root is `private: true`, so an
accidental publish from the root is refused by npm. And the packaging script
refuses to hand you a tarball with more than ten files or over 8 MB unpacked,
because that means the wrong directory was packed.

Check the `--dry-run` file list before the real publish. The package should
contain exactly the three bundled binaries, `package.json`, `README.md` and
`LICENSE` — no sources, no fixtures, no internal documents.

npm unpublishing is restricted after 72 hours, so treat the first publish as
permanent: the name, the version and the contents are public from then on.

## Versioning

The published version follows `packages/cli/package.json`. While the schema is
a draft, keep the prerelease suffix — `0.1.0-draft.N` tells installers what
they are getting, and npm treats it as a prerelease, so `npm install anvilmark`
will not resolve to it until a stable version exists or the user asks for the
tag explicitly.
