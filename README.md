# MCP Hub

Local-first **Model Context Protocol (MCP)** and AI workspace for Android/iOS (React Native + Expo Router in `mobile/`) and web (`src/`), with optional Express-backed account services and cloud synchronization. Connects directly to configured AI providers and remote MCP servers; availability and costs depend on provider plans.

---

## Architecture & File Tree

```text
├── src/
│   ├── config/models.ts                # Single source of truth for free-tier LLM model IDs
│   ├── types/index.ts                  # Strict TypeScript domain models, RunTrace, ToolPolicies & Zod schemas
│   ├── utils/
│   │   ├── redact.ts                   # Secret scrubbing & HTTPS enforcement
│   │   ├── localRag.ts                 # Zero-cost client-side chunking + BM25/3-gram RAG with citations
│   │   ├── docExport.ts                # ExcelJS, DOCX, PPTX, PDF executive document export
│   │   └── haptics.ts                  # Tactile feedback helpers
│   ├── server/
│   │   ├── authRouter.ts               # Async scrypt + refresh/revoked token auth
│   │   ├── controlRouter.ts            # Admin-token gated REST + remote MCP control & persisted activity log
│   │   └── workspaceRouter.ts          # Authenticated per-user workspace snapshot API
│   ├── services/
│   │   ├── auth/
│   │   │   ├── oauth.ts                # OAuth 2.1 + PKCE, RFC 8414/9728 discovery, DCR, 6 auth modes
│   │   │   └── oauth.test.ts           # Unit tests for auth, discovery & token refresh
│   │   ├── mcp/
│   │   │   ├── client.ts               # MCP 2025-06-18 Streamable HTTP + SSE, @ resources, / prompts, ping
│   │   │   ├── virtualSandbox.ts       # Built-in zero-network sandbox MCP server
│   │   │   └── client.test.ts          # Unit tests for MCP transport & 401 retry
│   │   ├── llm/
│   │   │   ├── types.ts                # Provider-agnostic streaming & tool-calling types
│   │   │   ├── gemini.ts               # Google Gemini streaming + thinkingLevel adapter
│   │   │   ├── openaiCompatible.ts     # Groq & OpenRouter streaming + reasoning_effort adapter
│   │   │   ├── demoProvider.ts         # Deterministic local simulator with Always-On A2UI widgets
│   │   │   ├── provider.ts             # Provider router, effort prompts & 429 auto-fallback
│   │   │   ├── agentLoop.ts            # Multi-step loop, parallel reads, prompt-injection guard, trace & policies
│   │   │   └── agentLoop.test.ts       # Unit tests for agent loop, policies, compaction & A2UI
│   │   └── storage/
│   │       ├── secureStorage.ts        # WebCrypto AES-GCM vault + optional PBKDF2 passphrase derivation
│   │       ├── syncDiff.ts             # Dirty-only Firestore batch sync diffing
│   │       ├── accountSync.ts          # Batched Firestore & REST account synchronization
│   │       └── historyDb.ts            # Local IndexedDB / SQLite-compatible chat history
│   ├── store/
│   │   ├── defaults.ts                 # Built-in agents, starter servers & SavedPrompt macros
│   │   └── useHubStore.ts              # Zustand global state + Compare Mode + Macros + RunTrace
│   ├── features/                       # Chat (Study, Pro Canvas IDE, Compare, Trace, Macros), Servers, Agents, Settings
│   └── ui/                             # MarkdownRenderer, A2UIWidgets, ToolCallCard, WriteApprovalBanner
└── mobile/                             # Ready-to-build React Native + Expo Router app
    ├── app/_layout.tsx                 # AppState background cleanup, biometric lock, mcphub:// & share links
    ├── app/(tabs)/                     # Chat (memory, voice cue, approvals), Servers, Agents, Settings tabs
    ├── services/notifications.ts       # Background local notifications for approvals & completed runs
    ├── services/storage/               # expo-secure-store & expo-sqlite adapters
    ├── services/auth/expoOAuth.ts      # expo-auth-session deep-link PKCE flow (mcphub://)
    ├── app.json & eas.json             # Expo & EAS free-tier APK build config
```

---

## How to Get Free API Keys (Zero Cost)

Use **Settings → Provider API keys** for authenticated providers. Kilo Gateway uses anonymous free access. OpenRouter and NVIDIA Build keys can be saved in the existing encrypted vault. Cloud models appear after their exact routes pass live verification and still qualify for no-charge inference. The model selector lists one entry for each model.

Choose **Code** in Chat to prioritize verified coding models for implementation, debugging, and repository work. Coding mode uses your existing MCP tool permissions and approvals.

See [free provider documentation](docs/free-providers.md) for provider status, exact IDs, routing rules, and the live test command.

---

## Security & Secret Vault

- **Mobile (`mobile/`)**: Provider API keys and MCP server tokens are stored in native OS Keychain (iOS) / Android Keystore via `expo-secure-store`, with cold-start and background-timeout biometric lock.
- **Web (`src/`)**: Uses WebCrypto AES-GCM encryption. By default, for zero-friction local usage, a device-local key is stored in `localStorage` alongside ciphertext (this deters casual plain-text inspection, not a determined XSS script). For stronger protection in shared or browser-persisted sessions, enable the optional **Passphrase-Derived Vault Key** in **Settings** (PBKDF2-SHA256, 250,000 iterations), which derives the AES-GCM key exclusively in memory and locks on reload.
- **Prompt-Injection Guard & Tool Policies**: External tool results are wrapped in `<untrusted_tool_output>` tags, scanned for override/exfiltration patterns, and forced through interactive write approval even if `Always allow` was previously granted. Per-tool `allow | ask | deny` rules and expiring `1h / 24h / 7d` allowances are configurable per agent or globally in Settings.
- **Control & Auth Server (`server.ts`)**: Configure `AUTH_SESSION_SECRET` in production to allow signed-in MCP Hub accounts to issue App API keys in Settings. Each account key works with that account’s connected browser workspace. Configure `MCP_HUB_ADMIN_TOKEN` separately to manage instance-wide keys. The OpenRouter provider key belongs in Provider API Keys. Control activity audit entries are persisted to `.data/control-activity.json` with secret redaction.

---

## Running & Testing Locally

```bash
# Install dependencies
npm install

# Run full lint (tsc + eslint) and all unit tests
npm run lint
npm test

# Run web preview on http://localhost:3000
npm run dev
```

---

## Building an Installable Android APK for Your Phone

All native Expo files live in `mobile/` and import the shared core services from `src/`.

### Option A: EAS Build (Cloud, Free Tier, No Android Studio Needed)

```bash
cd mobile
npm install
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

When the cloud build finishes, scan the QR code or open the download link on your Android phone to install the `.apk`.

### Option B: Local Build (`npx expo run:android`)

Requires Android Studio + Android SDK + USB debugging enabled on your phone:

```bash
cd mobile
npm install
npx expo prebuild --platform android
npx expo run:android --variant release
```

### Workspace improvements

The web app includes searchable conversations and pinned project files, project templates, model usage estimates, focus layout, scoped local Canvas drafts, and browser speech replies. The production web build caches its static app shell for offline reopening; cloud inference and account synchronization still need connectivity. Installability depends on the browser and hosting environment.

For local inference, add a custom model under Settings → Model catalog and choose **Local (loopback)**. Enter the installed model name exposed by an OpenAI-compatible service on `127.0.0.1:11434/v1`. The local model does not send MCP tool definitions or fall back to cloud providers; the service must be running on the device and allow the app's web origin. Account synchronization and explicitly selected cloud comparisons are separate features; use local guest mode for local-only storage. Real-device and local-service compatibility must be tested in the target deployment.
