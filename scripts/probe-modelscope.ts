import { catalogRoute, providerEndpoint, readProviderCatalog } from '../src/services/llm/freeRegistry';
import { streamSseData } from '../src/services/llm/sse';

const modelscope = process.env.MODELSCOPE_API_TOKEN?.trim();
if (!modelscope) throw new Error('ModelScope token is missing.');

const modelIds = [
  'zai-org/GLM-4.7-Flash', 'zai-org/GLM-5.2', 'moonshotai/Kimi-K3.1-Pro',
  'MiniMax/MiniMax-M3', 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
];
const issues = [
  ['account binding', /绑定|bind(?:ing)?[^.]{0,45}(?:alibaba|account)|alibaba[^.]{0,45}link/i],
  ['identity verification', /实名|real.?name|identity verific/i],
  ['terms or user authorization', /permission|accessdenied|agreement|authorize|条款|授权/i],
  ['quota', /quota|insufficient|余额|额度|grain/i],
  ['token rejected', /access.?token|invalid.?key|unauthenticated|authenti[cz]ation/i],
  ['security filter', /security (?:policy|check)|request (?:blocked|rejected)|waf/i],
  ['location or region', /region|country|location|地区/i],
] as const;

const rows = await readProviderCatalog('modelscope', { modelscope }, fetch, AbortSignal.timeout(15_000));
for (const model of modelIds) {
  const row = rows.find((entry) => entry.id === model);
  if (!row || !catalogRoute('modelscope', row)) {
    console.log(JSON.stringify({ model, eligible: false }));
    continue;
  }
  let status: number | undefined;
  let textChunks = 0;
  let reasoningChunks = 0;
  let finishReason: string | undefined;
  let done = false;
  try {
    const response = await fetch(`${providerEndpoint('modelscope')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35_000),
      headers: {
        Authorization: `Bearer ${modelscope}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model, stream: true, max_tokens: 512,
        messages: [{ role: 'user', content: 'Reply with the number 7.' }],
      }),
    });
    status = response.status;
    const isJson = response.headers.get('content-type')?.includes('json');
    if (!response.ok) {
      const errorText = await response.text();
      const issue = issues.find(([, pattern]) => pattern.test(errorText))?.[0];
      console.log(JSON.stringify({ model, status, issue, isJson }));
      continue;
    }
    if (response.body) {
      for await (const frame of streamSseData(response.body, () => { done = true; })) {
        const choice = JSON.parse(frame).choices?.[0];
        if (choice?.delta?.content) textChunks++;
        if (choice?.delta?.reasoning_content || choice?.delta?.reasoning) reasoningChunks++;
        if (['stop', 'length', 'tool_calls', 'error'].includes(choice?.finish_reason)) {
          finishReason = choice.finish_reason;
        }
      }
    }
    console.log(JSON.stringify({ model, status, textChunks, reasoningChunks, finishReason, done }));
  } catch {
    console.log(JSON.stringify({ model, status, textChunks, reasoningChunks, finishReason, done, interrupted: true }));
  }
}
