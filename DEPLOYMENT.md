# CYCASE deployment

The application is a static SPA. `npm run build` produces `dist/`, and any static host
serves it. Two host configurations are committed — `vercel.json` and `netlify.toml` — and
both express the same four requirements. Use whichever host you have an account for.

**Nothing in this file has been executed.** Deploying is an outward-facing action that
publishes the build; it needs an account and an explicit decision, so the commands below
are documented and left for the account holder to run.

## The five requirements, and why each one matters here

| Requirement | Why it is not optional for this app |
| --- | --- |
| A build-identity file at `/build-info.json` | A deployment you cannot identify is one you cannot roll back with confidence. The file is emitted by `vite.config.ts` from the same resolved identity as `window.__CYCASE_BUILD__`, and served `no-store` so the answer is never a cached one. Reading it needs `curl`, not a booted WebGL app. |
| SPA fallback to `index.html` | WebMCP tools register on the **top-level page**. A 404 shell registers nothing, so a judge landing on a deep link would see an app with no site tools and no way to know why. |
| `no-cache, must-revalidate` on `index.html` | The HTML names content-hashed assets. A cached HTML pointing at a rolled-back asset set is the classic white screen. |
| `immutable` on `/assets/*`, `/models/*`, `/fonts/*` | Vite content-hashes these. Without long caching the 3.4 MB of glTF and textures is re-fetched on every visit, which breaks the first-load budget on a judge's second look. |
| Correct MIME for `.glb` and `.woff2` | A host that serves `model/gltf-binary` as `text/plain` makes the office silently fall back to the 2D wall, which looks like a bug in the product rather than in the host. |

## Content Security Policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:;
worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none';
base-uri 'self'; form-action 'none'
```

Two notes on this, because both look like weaknesses and are not:

- **No `'unsafe-eval'`.** three.js compiles shaders through WebGL, not `eval`, so the
  strict policy holds. This was verified by running the office under the policy, not
  assumed.
- **`'unsafe-inline'` for `style-src` only.** The monitor overlay is positioned with an
  inline `matrix3d` transform recomputed as the camera moves; a nonce cannot be minted
  per frame. Script stays strict, which is where injection actually matters.
- **`connect-src 'self'`** means the page can reach its own API and nothing else. If the
  backend is deployed on a different origin, add exactly that origin — never a wildcard.

`frame-ancestors 'none'` is deliberate: WebMCP does not discover tools inside iframes, so
there is no reason for this page to be framed, and refusing it removes a clickjacking
surface.

## Deploy

```bash
npm ci
npm run test:all
```

Vercel — the host builds, so do **not** run `npm run build` first:

```bash
npx vercel@59 deploy --prod --yes --build-env BUILD_SHA="$(git rev-parse HEAD)"
```

> `--prebuilt` is not used here on purpose. It uploads `.vercel/output`, which
> `npm run build` never produces — that pairing deploys the wrong tree. If you want a local
> build, the correct pairing is `npx vercel@59 build --prod` then
> `npx vercel@59 deploy --prebuilt --prod`.

Netlify — `--dir` uploads an existing build, so here you do build first:

```bash
BUILD_SHA="$(git rev-parse HEAD)" npm run build
npx netlify-cli@latest deploy --dir=dist --prod
```

> The CLI is the **`netlify-cli`** package. The separate `netlify` package exposes a binary
> named `npxnetlify`, so `npx netlify deploy` does not run the CLI.

`BUILD_SHA` matters because the CLI upload carries no `.git`: without it the deployed build
honestly reports `"sha": "unknown"`. `scripts/buildDefines.ts` also reads Vercel's
`VERCEL_GIT_COMMIT_SHA` and Netlify's `COMMIT_REF` for git-connected builds.

## Verify the deployed build, not the local one

```bash
curl -sI https://<host>/ | grep -i cache-control
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/dashboard/evidence   # 200, not 404
curl -s https://<host>/build-info.json                                       # { sha, builtAt, version }
curl -sI https://<host>/models/<a-file>.glb | grep -i content-type           # model/gltf-binary
```

`/build-info.json` is emitted by `vite.config.ts` from the same resolved identity that is
substituted into the bundle, so it and `window.__CYCASE_BUILD__` cannot disagree. Its `sha`
must match the released commit; `"unknown"` means `BUILD_SHA` was not supplied. It is served
`no-store` so a CDN cannot answer the rollback question with a stale value.

The same identity is still readable in the browser console on the deployed origin:

```js
window.__CYCASE_BUILD__   // { sha, builtAt, version } — must match the released commit
```

## Rollback

Both hosts keep immutable deployments, so rollback is a promotion rather than a rebuild:

```bash
npx vercel@59 rollback <previous-deployment-url>
# or
npx netlify-cli@latest rollback
```

After rolling back, re-check the `sha` in `https://<host>/build-info.json` — or
`window.__CYCASE_BUILD__.sha` in the console. That is the only proof the rollback actually
took effect at the edge rather than only in the host's dashboard, and it is why that file is
served `no-store`.

## Backend

The browser completes Case 001 with no backend at all — that is a hard requirement of
`docs/BACKEND_RUNTIME_CONTRACT.md`, not a fallback. If the backend is deployed, it must be
same-origin or added explicitly to both the CORS allowlist and `connect-src`. Its
environment variables are listed by name in `.env.example`; no value belongs in this
repository.
