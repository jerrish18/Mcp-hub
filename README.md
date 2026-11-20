# MCP Hub

Zero-cost, zero-backend **Model Context Protocol (MCP)** chat client for Android/iOS (React Native + Expo Router in `mobile/`) and Web preview (`src/`). Connects directly over HTTPS to free-tier cloud LLMs and remote MCP servers.

---

## Architecture & File Tree

```text
├── src/
│   ├── config/models.ts                # Single source of truth for free-tier LLM model IDs
│   ├── types/index.ts                  # Strict TypeScript domain models & Zod schemas
│   ├── utils/
│   │   ├── redact.ts                   # Secret scrubbing & HTTPS enforcement
│   │   └── haptics.ts                  # Tactile feedback helpers
│   ├── services/
│   │   ├── auth/
│   │   │   ├── oauth.ts                # OAuth 2.1 + PKCE, RFC 8414/9728 discovery, DCR, 6 auth modes
│   │   │   └── oauth.test.ts           # Unit tests for auth, discovery & token refresh
│   │   ├── mcp/
│   │   │   ├── client.ts               # Streamable HTTP + SSE fallback JSON-RPC 2.0 client
│   │   │   ├── virtualSandbox.ts       # Built-in zero-network sandbox MCP server
│   │   │   └── client.test.ts          # Unit tests for MCP transport & 401 retry
│   │   ├── llm/
│   │   │   ├── types.ts                # Provider-agnostic streaming & tool-calling types
│   │   │   ├── gemini.ts               # Google Gemini streaming + thinkingLevel adapter
│   │   │   ├── openaiCompatible.ts     # Groq & OpenRouter streaming + reasoning_effort adapter
│   │   │   ├── demoProvider.ts         # Deterministic local simulator for zero-key testing
│   │   │   ├── provider.ts             # Provider router, effort prompts & 429 auto-fallback
│   │   │   ├── agentLoop.ts            # Multi-step tool loop, write-approval gate & abort
│   │   │   └── agentLoop.test.ts       # Unit tests for agent loop, approvals & 429 fallback
│   │   └── storage/
│   │       ├── secureStorage.ts        # AES-GCM encrypted vault (Web) & adapter interface
│   │       └── historyDb.ts            # Local IndexedDB / SQLite-compatible chat history
│   ├── store/
│   │   ├── defaults.ts                 # Built-in agents & starter server
│   │   └── useHubStore.ts              # Zustand global state
│   ├── features/                       # Chat, Servers, Agents, Settings & Onboarding screens
│   └── ui/                             # MarkdownRenderer, ToolCallCard, WriteApprovalBanner, BottomSheet
└── mobile/                             # Ready-to-build React Native + Expo Router app
    ├── app/_layout.tsx                 # AppState background cleanup & biometric lock
    ├── app/(tabs)/                     # Chat, Servers, Agents, Settings tabs
    ├── services/storage/               # expo-secure-store & expo-sqlite adapters
    ├── services/auth/expoOAuth.ts      # expo-auth-session deep-link PKCE flow (mcphub://)
    ├── app.json & eas.json             # Expo & EAS free-tier APK build config
```

---

## How to Get Free API Keys (Zero Cost)

1. **Google Gemini (Free Tier)**
   - Visit [Google AI Studio](https://aistudio.google.com/apikey) and sign in with a Google account.
   - Click **Create API key** and paste it into **Settings -> Google Gemini API Key**.
   - Includes generous free RPM/RPD quotas on Gemini Flash & Pro models.

2. **Groq Cloud (Free Tier)**
   - Visit [Groq Console](https://console.groq.com/keys) and create a free account.
   - Generate an API key (`gsk_...`) and paste it into **Settings -> Groq API Key**.
   - Provides ultra-fast free inference for Llama 3.3 70B, Qwen 3 32B, and GPT-OSS 120B.

3. **OpenRouter (Free Models)**
   - Visit [OpenRouter Keys](https://openrouter.ai/keys), create a free account, and click **Create Key** (`sk-or-v1-...`).
   - Free `:free` suffix models require zero credit balance.

> **Tip:** Free model IDs evolve quickly. Edit `src/config/models.ts` to update or swap model slugs in one place.

---

## Running & Testing Locally

```bash
# Install dependencies
npm install

# Run unit tests (OAuth/PKCE, MCP client, Agent loop)
npx --yes tsx --test src/services/auth/oauth.test.ts src/services/mcp/client.test.ts src/services/llm/agentLoop.test.ts

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
