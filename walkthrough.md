# MCP Hub — Audit, Model Verification, Firestore Sync & Security Walkthrough

## Overview of Fixes

1. **Decoupled Provider Key Validation & Explicit Model Statuses**
   - `validateProviderKey` and `validateAllConfiguredProviderKeys` validate saved provider credentials independently via `GET /models` (or Gemini `GET /v1beta/models`) rather than hiding an entire provider when a single hardcoded free route fails.
   - `classifyProviderFailure` and `getUnavailableCatalogModelsWithDetails` replace generic unavailable grouping with explicit status badges across both Web (`ModelSwitcherSheet`, `SettingsScreen`) and Mobile (`mobile/app/(tabs)/index.tsx`, `mobile/app/(tabs)/settings.tsx`): `Valid Key`, `No Key`, `Invalid Key (401)`, `Unsupported Param (400)`, `Rate Limited (429)`, `CORS Blocked`, and `Paid/Credit Route`.
   - Added **Manual Override** toggles (`settings.manualModelOverrides`) in Web and Mobile model pickers and Settings so users with valid credentials can enable any model outside the default free allowlist.

2. **Safe Probe & Non-Reasoning Parameter Handling**
   - `isProbe: true` calls (`testModelConnection`) and models without explicit reasoning support strip `reasoning_effort`, `chat_template_kwargs`, `reasoning`, and `thinkingConfig` before sending requests.
   - When an OpenAI-compatible route rejects a reasoning parameter with HTTP `400`, `streamOpenAiCompatibleCompletion` automatically strips those fields and retries once.

3. **Vault Hydration Race Condition & CORS Relay**
   - Store initialization awaits `loadProviderKeys()` before verifying configured keys and syncing models, and re-runs verification automatically after `setProviderKeys`, `unlockVault`, `enableVaultPassphrase`, and `disableVaultPassphrase`.
   - `/api/free-ai/:provider/*` (`src/server/freeAiRouter.ts`) proxies catalog checks and browser inference when direct browser calls fail with CORS/network errors across supported cloud providers, forwarding `X-MCPHub-Account` for Cloudflare and enforcing `X-MCPHub-UI` + `FREE_ROUTE_EVIDENCE` / `X-MCPHub-Manual-Override` checks.

4. **Local Loopback Mixed-Content Warning & Opt-In Local MCP Tools**
   - `SettingsScreen` (`#settings-models`) warns when the web app runs over `HTTPS` while targeting `http://127.0.0.1:11434/v1`.
   - Forwarding connected MCP tool schemas to local loopback models is gated behind an opt-in `"Enable MCP tools for local models"` toggle (`settings.localModelToolsEnabled`, defaulting to `false`), while keeping write-action approvals enforced.

5. **Firestore Rules & Sync Alignment (`workspace_batch` Fix)**
   - Updated `firestore.rules`, `firebase-blueprint.json`, and `src/services/storage/syncDiff.ts` to allow `'coding'` in `ConversationDoc.chatMode` and permit `localModelToolsEnabled` and `manualModelOverrides` inside `WorkspaceState.settings`.
   - Linted rules via `@firebase/eslint-plugin-security-rules` and deployed updated rules to Firebase.

6. **Dependency Lockfiles**
   - Removed `bun.lock`, ignored `bun.lock` and `bun.lockb` in `.gitignore`, and generated npm lockfiles (`package-lock.json` and `mobile/package-lock.json`) as the single source of truth across Web, CI, and Mobile builds.

# Security Summary

- **Credential Redaction in Traces & Exports**: `redactRunTrace` (`src/utils/runTrace.ts`) and `RunTraceSheet` (`src/features/chat/RunTraceSheet.tsx`) scrub decrypted provider API keys (`providerKeys`), bearer tokens, and `x-goog-api-key` headers before displaying, copying, or exporting RunTrace JSON/Markdown artifacts.
- **Content Security Policy & Sandboxed Previews**:
  - `index.html` includes a defensive `<meta http-equiv="Content-Security-Policy">` aligned with `server.ts` Helmet directives (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, explicit `frame-src` / `worker-src`), while production `server.ts` Helmet headers restrict `script-src` to `'self'` and `https://apis.google.com`.
  - Pro Canvas previews (`/src/utils/canvasPreview.ts`, `/src/server/canvasPreview.ts`) isolate generated HTML inside `/__canvas-preview` using `CANVAS_IFRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'` (never combining `allow-scripts` with `allow-same-origin`), strict `default-src 'none'` / `form-action 'none'` / `base-uri 'none'` headers, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.
- **Relay SSRF & Cost Guardrails**: `/api/free-ai/:provider/*` strictly validates providers against the `CLOUD_PROVIDERS` allowlist (`404` on unknown targets), requires `X-MCPHub-UI`, and blocks non-allowlisted models (`403`) unless explicitly overridden via `X-MCPHub-Manual-Override: 1`.
- **Local Model Tool Opt-In**: Loopback endpoints (`127.0.0.1:11434/v1`) receive zero MCP tool definitions by default until `localModelToolsEnabled` is enabled, and write-approval gates stay active.

## PoC Verification

- **Unit & Integration Tests (`npm test`)**:
  - Added `src/services/llm/providerValidation.test.ts` covering decoupled key validation (`valid` vs `Invalid Key (401)`), failure classification (`No Key`, `Rate Limited (429)`, `Unsupported Param (400)`, `CORS Blocked`), manual override enabling + inference dispatch, `isProbe` stripping + HTTP `400` retry on Groq and OpenRouter, opt-in `allowLocalTools` enforcement, `redactRunTrace` API key scrubbing in JSON/Markdown exports, and `freeAiRouter` SSRF/header enforcement.
  - Extended `src/services/storage/accountSync.test.ts` verifying `sanitizeSettingsForSync` and `sanitizeConversationForSync` preserve `coding`, `localModelToolsEnabled`, and `manualModelOverrides`.
- **Lint, Build & Mobile Typecheck**:
  - Executed `npm run lint` (including `@firebase/eslint-plugin-security-rules` on `firestore.rules`), `npm test`, `npm run build`, and `npm ci --prefix mobile && npm run typecheck --prefix mobile` with zero errors.
- **Live Browser & Header Verification (`http://localhost:3000`)**:
  - Verified clean app launch, onboarding flow, `Choose AI Model` modal (`Valid Key`, `No Key`, `Paid/Credit Route` badges + toggling `Enable` override), and `Settings -> Models & Connectivity` (`Enable MCP tools for local models` defaulting to OFF, override reflection in test dropdown).
  - Verified live HTTP response headers on `GET /__canvas-preview` return `sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads` (without `allow-same-origin`), `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.
