# Free cloud providers

MCP Hub lists each verified model once. A canonical model can have multiple routes with distinct upstream model IDs. The Settings catalog refreshes at launch, when the app returns to the foreground, and periodically while active. It shows discovered free candidates awaiting verification separately from the selector. The app rechecks eligibility before inference and stops serving a route if the catalog becomes unavailable, expires, or reports a price.

| Provider | Access and eligibility |
| --- | --- |
| [Kilo Gateway](https://kilo.ai/docs/gateway/models-and-providers) | Anonymous requests use explicit catalog IDs that advertise free access and zero cost. Some models retain prompts for training and the selector labels those routes. |
| [OpenRouter](https://openrouter.ai/docs/guides/routing/model-variants/free) | Add a free-account key. An explicit `:free` ID must report zero input, output, and other inference charges. Requests enforce a zero maximum price at the router. The gateway's automatic model routers are excluded. |
| [NVIDIA Build](https://build.nvidia.com/models) | Add an NVIDIA Build developer API key. Candidates come from documented free hosted endpoints on `integrate.api.nvidia.com`. Partner and self-hosted endpoints are excluded. Verified routes share the selector entry with their equivalent Kilo or OpenRouter routes. |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Settings and catalog transport support an account ID and scoped token. Workers Paid can charge after the daily allowance. Account and model-specific free eligibility require verifiable billing status before inference can be enabled. Cloudflare also restricts some Kimi and GLM models to paid access. |
| [Gemini](https://ai.google.dev/gemini-api/docs/pricing) and [Groq](https://groq.com/pricing) | The existing credentials, catalog clients, and inference adapters are retained. They remain ineligible for cloud routing until the app can verify that the supplied credential cannot incur charges. |
| [OpenCode](https://opencode.ai/docs/console/api/inference/) | The public inference API rejects free-tier chat requests from third-party clients. |
| [Nous Portal](https://portal.nousresearch.com/) | Its free portal models do not establish free API access. API keys draw on pay-as-you-go credits. |
| [SambaNova](https://cloud.sambanova.ai/plans) | The current free plan requires adding a payment method and purchasing credits before inference. |

## Live verification

| Route | Live result |
| --- | --- |
| Kilo `reflection/beam-free` | Passed anonymous streaming, TypeScript, reasoning, and a tool call with a follow-up result. |
| Kilo `nvidia/nemotron-3-ultra-550b-a55b:free` | Passed anonymous streaming, TypeScript, reasoning, and a tool call with a follow-up result. |
| Kilo `recursive/flint-v1.0:free` and `particle-ai/particle-1:free` | Streamed TypeScript, then failed the reasoning check. They remain disabled. |
| NVIDIA `nvidia/nemotron-3-ultra-550b-a55b` and `nvidia/nemotron-3.5-super-vl-120b-a12b` | Passed live streaming, TypeScript, reasoning, and a tool round trip. Super VL also passed the image check. |
| NVIDIA `z-ai/glm-5.3-flash`, `z-ai/glm-5.3`, and `nvidia/nemotron-3.5-lightning-30b-a3b` | The Flash route timed out, the full GLM was absent from the account catalog, and the Lightning route did not pass its coding and streaming check. |
| OpenRouter `nvidia/nemotron-3-ultra-550b-a55b:free` | Passed authenticated zero-price streaming, TypeScript, reasoning, and a tool round trip in the initial run. The retry confirmed free-tier account status and passed live fallback from Kilo under a simulated HTTP 429. Its repeated coding exercise did not pass. It shares the Nemotron 3 Ultra selector entry with Kilo. |
| OpenRouter `nvidia/nemotron-3.5-lightning:free` and `nvidia/nemotron-3.5-super-vl:free` | Passed free-tier account verification, streaming, TypeScript, reasoning, and a tool round trip. Super VL also passed the image check. |
| OpenRouter `google/gemma-4-26b-a4b-it:free`, `google/gemma-4-31b-it:free`, and `particle-ai/particle-1:free` | Retry encountered HTTP 429. The routes remain disabled. |
| OpenRouter `recursive/flint-v1.0:free` | Tool calling returned HTTP 404. The route remains disabled. |

Place test credentials in your secure environment as `NVIDIA_API_KEY` and `OPENROUTER_API_KEY`. Store app credentials in Settings or Expo's encrypted device vault. Use an NVIDIA Build developer key and an OpenRouter account with no paid balance for live verification.

```sh
npm run verify:free-route -- kilo reflection/beam-free
npm run verify:free-route -- nvidia z-ai/glm-5.3-flash
npm run verify:free-route -- openrouter vendor/model:free
```

The command checks the live catalog before posting a request. For OpenRouter it also checks that the test credential reports free-tier access. It reports the phase and pass status without printing credentials, prompts, or provider errors. It checks incremental output, a small TypeScript exercise, a reasoning task, and advertised tool and image support. A reviewer records results and confirms the canonical model identity in `src/config/freeRouteEvidence.ts` before a route becomes selectable.

To verify cross-provider fallback, use a canonical model with at least two verified routes. The script simulates a rate limit on the initial route and requires a live stream from a different provider. This passed from Kilo to OpenRouter for Nemotron 3 Ultra.

```sh
node --import tsx scripts/verify-free-failover.ts nvidia/nemotron-3-ultra-550b-a55b
```

## Routing and Coding mode

Pick a particular model to restrict fallback to routes serving that canonical model. Coding mode defaults to **Automatic free model**. It can try a different verified coding model before the first output when the initial choice fails. After any answer, reasoning, or tool output appears, an interruption preserves the partial result. Route choice accounts for required tools, image input, observed latency, rate limits, and remaining quota when providers publish it. MCP tool execution still uses the existing permission checks. The model picker and Settings show currently eligible routes and disclosed training terms.
