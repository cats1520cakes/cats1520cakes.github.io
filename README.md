# Haoqi He — AI-native Academic Homepage

This repository preserves the existing Academic Pages/Jekyll site and adds a Cloudflare Worker research interface. Static pages and `/api/*` ship as one Cloudflare Workers deployment; the browser never receives a model-provider credential.

## Architecture

```text
Browser
  ├─ static page/assets ───────────────> Cloudflare Static Assets (_site)
  ├─ Turnstile ────────────────────────> server-verified, single-use challenge
  └─ signed AI session + /api/* ───────> Cloudflare Worker
                                         ├─ endpoint-scoped HMAC session
                                         ├─ session/client rate limiting
                                         ├─ bundled public knowledge retrieval
                                         ├─ optional public URL/search context
                                         └─ DeepSeek-compatible API
                                              Authorization: server-side secret only
```

The repository did not contain a Vercel runtime or configuration. The deployment migration is therefore from GitHub Pages-only hosting to Cloudflare Workers + Static Assets. GitHub Pages can remain a static fallback until DNS is switched.

### Research modes

- **Research Q&A** — retrieves local evidence and returns inline source identifiers.
- **Challenge My Research** — separates claim, evidence, bounds, falsification, and next experiment; the default output type is `evidence_analysis`, not a fabricated run.
- **Collaboration Fit** — assesses demonstrated overlap, gaps, and a concrete next question from a topic, role, paper page, or public URL.

External pages and search snippets are tagged `untrusted_external`. They can be analyzed, but they cannot silently establish facts about Haoqi He.

## Secret boundary

`DEEPSEEK_API_KEY`, `TURNSTILE_SECRET_KEY`, and `AI_SESSION_SECRET` must exist only as Cloudflare encrypted secrets or in an ignored local `.dev.vars` file. Do not place them in `wrangler.jsonc`, Jekyll front matter, JavaScript, HTML, GitHub Actions YAML, or any `PUBLIC_*` variable. `TURNSTILE_SITE_KEY` is public but is still supplied by the Worker at runtime so the static build remains environment-neutral.

```bash
# Production: prompts securely; the value is not written to the repository.
pnpm exec wrangler secret put DEEPSEEK_API_KEY
pnpm exec wrangler secret put TURNSTILE_SITE_KEY
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY

# Generate rather than hand-author the HMAC signing secret.
openssl rand -base64 48 | pnpm exec wrangler secret put AI_SESSION_SECRET

# Optional external-search provider secret.
pnpm exec wrangler secret put SEARCH_API_KEY
```

For local Worker development:

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars locally. It is ignored by git.
```

The safe, non-secret defaults in `wrangler.jsonc` are:

- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-v4-flash`
- `SEARCH_PROVIDER=none`

Set `SEARCH_PROVIDER` to `brave` or `tavily` only after adding `SEARCH_API_KEY` as a Worker secret. Model and base URL remain configurable so model identifiers can change without a frontend rebuild.

## Local development

Requirements: Ruby 3.3+, Bundler, Node 22+, and pnpm 11.9.

```bash
bundle install
pnpm install --frozen-lockfile

# Full static build, type check, and secret scan
pnpm run build

# Cloudflare preview, including /api/agent (http://localhost:8787)
pnpm run dev:worker

# Jekyll-only visual preview; the agent degrades to an explicit offline state
pnpm run dev -- --port 7100
```

The Worker preview requires all four AI/Turnstile values in `.dev.vars` to make a real model request. Missing gate configuration fails closed before any model call. `pnpm run check:release` intentionally rejects a delivery directory that still contains `.dev.vars` or `.env`.

## Knowledge base

`pnpm run kb:build` scans canonical records plus CV/publication Markdown, chunks them by semantic section, records provenance, and writes:

- `knowledge/chunks.json` — Worker retrieval corpus;
- `knowledge/manifest.json` — source hashes and incremental reuse state;
- `knowledge/report.md` — build coverage and projects intentionally not promoted to facts.

Source priority is:

1. owner-confirmed current profile facts;
2. official proceedings, anthology, arXiv, and publisher pages;
3. local publication/CV records;
4. runtime external context, always untrusted.

Changed inputs are rebuilt; unchanged sources reuse their prior chunks. Runtime web results are never written back into the trusted corpus automatically.

## API surface

### `GET /api/health`

Returns only the public gate state, public Turnstile site key when enabled, and corpus chunk count. Provider and secret configuration details are not exposed.

### `POST /api/ai-session`

Redeems a single-use Turnstile token through Cloudflare Siteverify and returns a 30-minute HMAC-signed session bound to the requesting client and exactly one scope: `agent`, `zombie`, or `elite`. Session tokens are held in browser memory only.

### `POST /api/agent`

```json
{
  "mode": "qa",
  "question": "What is measured versus theoretical in Q-Detection?",
  "contextUrl": "https://www.ijcai.org/proceedings/2025/593",
  "useSearch": false,
  "history": []
}
```

The response is Server-Sent Events with `meta`, `sources`, `status`, `delta`, `done`, and `error` events. The UI renders a constrained Markdown subset using DOM text nodes; model output is never inserted as raw HTML.

## Security controls

- same-origin POST and preflight validation as a CORS boundary, not authentication;
- mandatory server-side Turnstile verification before a session is issued;
- short-lived HMAC sessions bound to endpoint scope, client fingerprint, and expiry;
- encrypted Worker secrets; no browser-visible key path;
- 8,000-character question, bounded history, and 64 KB request body;
- Cloudflare Rate Limiting bindings: 3 session issuances, 6 research requests, or 20 total game requests per minute per session/client key;
- HTTPS-only public URL reader with private/local address, credential, port, redirect, content-type, size, and timeout checks;
- external-content prompt-injection boundary;
- upstream timeout and safe provider-error mapping;
- streamed output filters out reasoning fields and requests non-thinking mode;
- strict static security headers, no frames, and no microphone/camera permissions;
- repository/static-output credential-shape scan via `pnpm run check:secrets`.

The gate fails closed when Turnstile, signing secrets, or rate-limit bindings are unavailable. For higher-volume traffic, additionally set provider-side spending limits and a Cloudflare WAF rule; public AI cannot be protected by a frontend-only secret.

## Verification

```bash
pnpm test                 # retrieval, prompt, SSRF/origin, and route tests
pnpm run typecheck        # strict TypeScript
pnpm run build            # KB + clean Jekyll build + typecheck + secret scan
pnpm run check:release    # fails if local secret files remain in the delivery tree
pnpm exec wrangler deploy --dry-run
```

## Deploy to Cloudflare

1. Authenticate with `pnpm exec wrangler login`.
2. Create a hostname-restricted Managed Turnstile widget for the final Worker/custom-domain hostname.
3. Add newly rotated `DEEPSEEK_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and a generated `AI_SESSION_SECRET` using `wrangler secret put`.
4. Run `pnpm run deploy`; the release scan refuses to deploy while a local `.dev.vars` or `.env` exists.
5. Add the desired Custom Domain, update `_config.yml` and `ALLOWED_ORIGINS`, then set `workers_dev` to `false`. Preview URLs are already disabled.

The manual GitHub Actions workflow `.github/workflows/cloudflare-deploy.yml` requires repository/environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The DeepSeek key remains attached directly to the Worker in Cloudflare and is not passed through GitHub Actions.

## Current operational boundaries

- The bundled lexical retriever is appropriate for the current small public corpus and Cloudflare free-tier CPU constraints. D1/Vectorize should be introduced only when corpus scale, semantic recall, or update frequency warrants it.
- Direct URL reading supports public HTML/plain-text landing pages, not PDF parsing.
- External search is disabled until a provider and its server-side secret are configured.
- Deployment, Turnstile creation, provider spending limits, and custom-domain activation require the owner's Cloudflare account; this repository intentionally contains no account credential or API key.
