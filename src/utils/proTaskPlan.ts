export const PRO_PLAN_SYSTEM_PROMPT = [
  '[PRO TASK PLAN]',
  'Draft an ordered plan for the user to review before any work begins.',
  'Return only JSON in the form {"steps":["Short actionable step","Another actionable step"]}.',
  'Use 2 to 5 distinct steps and cover the requested work and verification. Keep each step under 180 characters.',
  'Inspect only the supplied request. No tools or external actions are available while planning.',
].join('\n');

export type ProTaskPlanStatus = 'review' | 'running' | 'completed' | 'stopped' | 'cancelled';
export type ProTaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ProTaskPlan {
  status: ProTaskPlanStatus;
  steps: Array<{ title: string; status: ProTaskStepStatus }>;
}

const ACTION = '(?:add|analyze|build|check|compare|create|deploy|design|document|evaluate|export|fix|generate|implement|inspect|list|plan|push|read|review|run|summari[sz]e|test|update|verify|write)';
const SEQUENCE = new RegExp(`\\b(?:and then|and(?=\\s+(?:also\\s+)?${ACTION}\\b)|then|after that|finally)\\b`, 'gi');

export function normalizeProPlan(values: unknown[]): string[] {
  const titles = values.filter((value): value is string => typeof value === 'string')
    .map((value) => value.replaceAll(/\s+/g, ' ').trim().slice(0, 180)).filter(Boolean);
  return [...new Set(titles)].slice(0, 5);
}

export function splitProTask(text: string): string[] {
  const lines = text.split('\n');
  const listed = lines.flatMap((line) => {
    const match = /^\s*(?:\d{1,2}[.)]|[-*])\s+(.+)/.exec(line);
    return match ? [match[1]] : [];
  });
  if (listed.length > 1) return normalizeProPlan(listed);
  const tasks = text.split(SEQUENCE).map((part) => part.replace(/^[\s,.:;]*(?:first\b[\s,]*)?|[\s,;]+$/gi, '').trim());
  return normalizeProPlan(tasks);
}

export function shouldPlanProTask(text: string): boolean {
  if (text.length < 24 || /^\s*(?:explain|what|why|how)\b/i.test(text)) return false;
  return splitProTask(text).length > 1;
}

export function parseProTaskPlan(text: string): string[] {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')) as { steps?: unknown };
    return Array.isArray(value?.steps) ? normalizeProPlan(value.steps) : [];
  } catch {
    return [];
  }
}

export function makeProTaskPlan(titles: string[], status: ProTaskPlanStatus): ProTaskPlan {
  return { status, steps: titles.map((title) => ({ title, status: 'pending' })) };
}

export function finishProTaskPlan(plan: ProTaskPlan, stopped = false): ProTaskPlan {
  const status = plan.status === 'cancelled' ? 'cancelled' :
    stopped || plan.steps.some((step) => step.status !== 'completed') ? 'stopped' : 'completed';
  return {
    status,
    steps: plan.steps.map((step) => step.status === 'pending' || step.status === 'running'
      ? { ...step, status: 'skipped' } : step),
  };
}
