# RCS release-please + ghcr image publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let release-please manage `packages/rcs` releases (its own semver, `CHANGELOG.md`, `rcs-vX.Y.Z` tag, GitHub Release) and, whenever an rcs release is created, build and push the rcs Docker image to `ghcr.io/<owner>/rcs` for servers to pull.

**Architecture:** Switch the Release workflow from release-please's _simple_ mode (action input `release-type`, which ignores `release-please-config.json`) to _manifest_ mode (config file + `.release-please-manifest.json`). The manifest gains a second package (`packages/rcs`) while keeping the root CLI package untouched (`vX.Y.Z` tags, npm publish). A new conditional job in `release.yml` builds `packages/rcs/Dockerfile` (repo-root context, linux/amd64) from the release tag and pushes it to GHCR.

**Tech Stack:** release-please 17.6.0 (root devDependency) + `googleapis/release-please-action@v4`, GitHub Actions (`docker/login-action@v3`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`), Docker Compose, GHCR (GitHub Container Registry).

**Spec:** none — chat-approved design playback, 2026-11-18 (scope: no npm publish, CI pushes image, server pulls; ghcr.io; linux/amd64 only).

## Global Constraints

- rcs is **not** published to npm; only the CLI keeps `npm publish ./dist` via `publish.yml`.
- CLI releases must stay byte-identical in behavior: tags remain `vX.Y.Z`; `feat(rcs)` commits must not bump the CLI version.
- Docker build context stays the repository root (`bun install --frozen-lockfile` needs the root lockfile and workspace manifests).
- Image name: `ghcr.io/<repository_owner>/rcs`; tags: `<version>` and `latest`; platform `linux/amd64` only.
- Conventional-commit messages (commitlint); commit directly to `main`.
- Gates: `bun run fmt:check` must pass; no changes to `rcs:*` gates.

## Review Focus

- An rcs release must never create a CLI release, and a CLI release must never build the rcs image (wrong `if:` guard → cross-release).
- The first rcs release PR must not include pre-scaffold or CLI-only commits, and its changelog must not balloon from unrelated history.
- Manifest-mode parsing must not crash on the existing `$schema` keys (`Version.parse` throws on anything that is not semver — see Task 1).
- The CLI tag pattern must remain component-less (`v1.2.0`, not `@sobird/claude-code-v1.2.0`); manifest mode ignores the action's `include-component-in-tag` default.
- The GHCR push must authenticate with `GITHUB_TOKEN` and hold `packages: write` only on that job.

---

### Task 1: Enable manifest mode for release-please (root + rcs)

**Files:**

- Modify: `release-please-config.json`
- Modify: `.release-please-manifest.json`
- Test: one-off node check (inline command, not committed)

**Interfaces:**

- Produces: manifest config consumed by `googleapis/release-please-action@v4` in Task 2. Outputs per package: `.` → `release_created`/`tag_name`/`version`; `packages/rcs` → `packages/rcs--release_created`/`--version`/`--tag_name`.

- [ ] **Step 1: Rewrite `release-please-config.json`**

New content (exact):

```json
{
  "$schema": "./node_modules/release-please/schemas/config.json",
  "plugins": ["node-workspace"],
  "release-type": "node",
  "include-component-in-tag": false,
  "bootstrap-sha": "8f9661eeca51c3d45821926f65c0d451fa6c6320",
  "exclude-paths": ["packages/rcs"],
  "packages": {
    ".": {},
    "packages/rcs": {
      "component": "rcs",
      "include-component-in-tag": true,
      "bump-minor-pre-major": true,
      "exclude-paths": []
    }
  }
}
```

Why each line:

- `".": {}` — `release-please` builds its package list from `packages` only; the root CLI must be listed or it silently stops being released.
- top-level `include-component-in-tag: false` — manifest mode ignores the action's `include-component-in-tag: false` default; without this the CLI tag becomes `@sobird/claude-code-v1.2.0`.
- `packages/rcs` `include-component-in-tag: true` + `component: rcs` → tag `rcs-v0.2.0`.
- `packages/rcs` `exclude-paths: []` — top-level `exclude-paths` is inherited by every package (verified in `release-please/build/src/util/commit-exclude.js` + `mergeReleaserConfig`); without the override all rcs commits would be filtered out of rcs's own changelog.
- `bootstrap-sha` = scaffold commit `8f9661e` — rcs has no prior release, so without it the scan stops at the search-depth cap; with it the first release's changelog covers rcs work since scaffolding (all 116 rcs commits, one time).
- `bump-minor-pre-major: true` — breaking `feat!` stays in `0.x` (0.2.0) instead of jumping to 1.0.0.

- [ ] **Step 2: Rewrite `.release-please-manifest.json`**

New content (exact):

```json
{
  ".": "1.0.0",
  "packages/rcs": "0.1.0"
}
```

`.` is the last **published** CLI version (`v1.0.0`); the open `release 1.1.0` PR branch is unmerged and must not be recorded as released.

The `$schema` key **must be removed**: `parseReleasedVersions` runs `Version.parse` on every value and throws on `"./node_modules/release-please/schemas/manifest.json"` (verified locally). Keep `release-please-config.json`'s `$schema` — only its known keys are read.

- [ ] **Step 3: Verify manifest parsing**

Run:

```bash
node -e "const {Version}=require('release-please/build/src/version');const m=require('./.release-please-manifest.json');for(const [k,v] of Object.entries(m)){console.log(k, Version.parse(v).toString())}"
```

Expected: two lines, `. 1.0.0` and `packages/rcs 0.1.0`, exit 0.

- [ ] **Step 4: Verify resolved per-path config (static, never `--local`)**

**Never run `release-please debug-config --local`**: it executes `git fetch origin && git checkout main && git reset --hard origin/main` on `--local-path`, silently wiping local commits and edits (observed twice on 2026-11-18). Use this read-only check instead:

```bash
node -e "
const {Version}=require('release-please/build/src/version');
const cfg=require('./release-please-config.json');
const man=require('./.release-please-manifest.json');
for (const [k,v] of Object.entries(man)) console.log('manifest', k, Version.parse(v).toString());
const d={rt:cfg['release-type'],ict:cfg['include-component-in-tag'],ep:cfg['exclude-paths']};
for (const [p,o] of Object.entries(cfg.packages)) console.log(p, JSON.stringify({releaseType:o['release-type']??d.rt,component:o['component'],includeComponentInTag:o['include-component-in-tag']??d.ict,excludePaths:o['exclude-paths']??d.ep,bumpMinorPreMajor:o['bump-minor-pre-major']??false}));
"
```

Expected: root resolves to `includeComponentInTag:false`, `excludePaths:["packages/rcs"]`; `packages/rcs` resolves to `includeComponentInTag:true`, `component:"rcs"`, `excludePaths:[]`, `bumpMinorPreMajor:true`.

- [ ] **Step 5: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci(rcs): manage rcs releases through a release-please manifest"
```

---

### Task 2: Manifest-mode Release workflow + GHCR image job

**Files:**

- Modify: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: manifest config from Task 1.
- Produces: env-visible image `ghcr.io/<owner>/rcs:<version>` and `:latest`.

- [ ] **Step 1: Switch the action to manifest mode and expose rcs outputs**

In the `release` job, delete the `release-type: node` input (its presence makes `release-please-action` call `Manifest.fromConfig` and ignore the config file). Replace the job `outputs` with:

```yaml
outputs:
  created: ${{ steps.release.outputs.release_created }}
  rcs_released: ${{ steps.release.outputs['packages/rcs--release_created'] }}
  rcs_version: ${{ steps.release.outputs['packages/rcs--version'] }}
  rcs_tag: ${{ steps.release.outputs['packages/rcs--tag_name'] }}
```

Keep `token: ${{ secrets.GITHUB_TOKEN }}` in `with:` and nothing else.

- [ ] **Step 2: Add the image job after `publish`**

```yaml
publish-image:
  if: needs.release.outputs.rcs_released == 'true'
  needs: release
  runs-on: ubuntu-latest
  permissions:
    contents: read
    packages: write
  steps:
    - name: Check out the release tag
      uses: actions/checkout@v6
      with:
        ref: ${{ needs.release.outputs.rcs_tag }}

    - name: Set up Buildx
      uses: docker/setup-buildx-action@v3

    - name: Log in to GHCR
      uses: docker/login-action@v3
      with:
        registry: ghcr.io
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Build and push
      uses: docker/build-push-action@v6
      with:
        context: .
        file: packages/rcs/Dockerfile
        platforms: linux/amd64
        push: true
        tags: |
          ghcr.io/${{ github.repository_owner }}/rcs:${{ needs.release.outputs.rcs_version }}
          ghcr.io/${{ github.repository_owner }}/rcs:latest
```

- [ ] **Step 3: Validate YAML and guards**

Run:

```bash
node -e "const y=require('yaml');const fs=require('fs');const w=y.parse(fs.readFileSync('.github/workflows/release.yml','utf8'));const j=w.jobs;console.log(Object.keys(j), j.release.outputs, j['publish-image'].if)"
```

Expected: release job outputs contain all four keys; `publish-image.if` references `rcs_released`; `release.steps[0].with` has no `release-type`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(rcs): publish the rcs image to ghcr on release"
```

---

### Task 3: Pullable image in compose + docs

**Files:**

- Modify: `packages/rcs/docker-compose.yml`
- Modify: `packages/rcs/README.md`
- Modify: `packages/rcs/CLAUDE.md`

**Interfaces:**

- Consumes: image tags produced by Task 2.

- [ ] **Step 1: Parameterize the image**

In `packages/rcs/docker-compose.yml`, change the anchor line `image: rcs:local` to:

```yaml
image: ${RCS_IMAGE:-rcs:local}
```

Leave the `build:` block untouched so local `docker compose up --build` is unchanged.

- [ ] **Step 2: Document the pull flow**

In `packages/rcs/README.md`, after the paragraph ending "…`gateway` service overrides the default command with `bun /app/dist/gateway.js`; `app` runs the Next standalone server." insert:

````markdown
### Deploying a published image

Releases publish an image to `ghcr.io/<owner>/rcs` tagged with the release
version and `latest` (linux/amd64). On a server, pin the version and pull:

```bash
export RCS_IMAGE=ghcr.io/sobird/rcs:0.2.0
docker compose pull
docker compose up -d --no-build
```

The package is private by default; `docker login ghcr.io` with a PAT that can
read packages, or change the package visibility on GitHub. `RCS_IMAGE` unset
falls back to building `rcs:local` locally.
````

- [ ] **Step 3: Update `packages/rcs/CLAUDE.md`**

Replace the bullet with:

```markdown
- CI: `.github/workflows/rcs.yml` (gates only). Releases use release-please
  manifest mode: `feat(rcs):`/`fix(rcs):` commits bump `packages/rcs` to its
  own `rcs-vX.Y.Z` tag/CHANGELOG and do not affect the CLI's version. A
  release pushes `ghcr.io/<owner>/rcs:<version>` and `:latest` (linux/amd64);
  rcs is not published to npm.
```

- [ ] **Step 4: Verify compose interpolation and formatting**

Run:

```bash
docker compose -f packages/rcs/docker-compose.yml config --no-interpolate 2>/dev/null | grep -m1 image || true
bun run fmt:check
```

Expected: fmt check exit 0. If Docker is unavailable, skip the compose command and rely on the diff (single-line substitution).

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/docker-compose.yml packages/rcs/README.md packages/rcs/CLAUDE.md
git commit -m "docs(rcs): document releases and pulling the ghcr image"
```
