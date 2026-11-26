// NVIDIA documents max as the default thinking budget for GLM 5.3 Flash.
export function nvidiaGlmFlashOptions(modelId: string, effort: unknown) {
  if (modelId !== 'z-ai/glm-5.3-flash') return undefined;
  return {
    reasoning_effort: effort === 'high' ? 'high' : 'low',
    chat_template_kwargs: { clear_thinking: true },
  };
}
