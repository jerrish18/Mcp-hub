export function nvidiaRequestOptions(modelId: string, effort: unknown) {
  const boundedEffort = effort === 'high' ? 'high' : 'low';
  switch (modelId) {
    case 'z-ai/glm-5.3':
    case 'z-ai/glm-5.3-flash':
      // GLM defaults to the maximum thinking budget.
      return { reasoning_effort: boundedEffort, chat_template_kwargs: { clear_thinking: true } };
    case 'moonshotai/kimi-k3.1-pro':
      return { reasoning_effort: boundedEffort };
    case 'minimaxai/minimax-m3.1-flash':
      return { chat_template_kwargs: { reasoning_effort: effort === 'medium' ? 'medium' : boundedEffort } };
    default:
      return undefined;
  }
}
