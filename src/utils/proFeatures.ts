export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export function computeLineDiff(before: string, after: string, maxLines = 180): DiffLine[] {
  const aLines = before.split(/\r?\n/).slice(0, maxLines);
  const bLines = after.split(/\r?\n/).slice(0, maxLines);
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < aLines.length || j < bLines.length) {
    const a = aLines[i];
    const b = bLines[j];
    if (a !== undefined && b !== undefined && a === b) {
      out.push({ kind: 'same', text: a });
      i++;
      j++;
    } else if (a !== undefined && !bSet.has(a)) {
      out.push({ kind: 'removed', text: a });
      i++;
    } else if (b !== undefined && !aSet.has(b)) {
      out.push({ kind: 'added', text: b });
      j++;
    } else {
      if (a !== undefined) {
        out.push({ kind: 'removed', text: a });
        i++;
      }
      if (b !== undefined) {
        out.push({ kind: 'added', text: b });
        j++;
      }
    }
    if (out.length >= maxLines * 2) break;
  }

  return out;
}

export interface ApprovalDiffEntry {
  field: string;
  before: string;
  after: string;
  lines: DiffLine[];
}

export function buildApprovalBeforeAfterDiff(
  toolName: string,
  args: Record<string, unknown>
): ApprovalDiffEntry[] {
  const entries: ApprovalDiffEntry[] = [];

  if (toolName === 'github_push_files_batch' && Array.isArray(args.files)) {
    for (const rawFile of args.files.slice(0, 6)) {
      if (!rawFile || typeof rawFile !== 'object') continue;
      const f = rawFile as Record<string, unknown>;
      const path = String(f.path ?? 'file');
      const content = String(f.content ?? '');
      entries.push({
        field: `file:${path}`,
        before: '(remote branch state)',
        after: content,
        lines: computeLineDiff('', content, 25),
      });
    }
    return entries;
  }

  for (const [key, val] of Object.entries(args)) {
    const after =
      typeof val === 'string'
        ? val
        : typeof val === 'object' && val !== null
          ? JSON.stringify(val, null, 2)
          : String(val ?? '');
    const before =
      toolName.includes('delete') ? '(existing record)' : '(unset / prior value)';
    entries.push({
      field: key,
      before,
      after,
      lines: computeLineDiff(before, after, 30),
    });
  }

  return entries;
}

export interface PlanStepItem {
  id: string;
  title: string;
  detail?: string;
  done: boolean;
}

export function shouldOfferProPlan(promptText: string, chatMode: string): boolean {
  if (chatMode !== 'professional') return false;
  const trimmed = promptText.trim();
  if (trimmed.length < 35) return false;
  const multiStepVerbs =
    /\b(build|create|develop|architect|implement|refactor|migrate|deploy|sync|design|analyze)\b/i;
  const compoundMarkers = /\b(and|then|with|plus|also|into|multi-?file|full[- ]?stack|github|dashboard)\b/i;
  return multiStepVerbs.test(trimmed) && (compoundMarkers.test(trimmed) || trimmed.length > 90);
}

export function buildExecutionPlanDraft(promptText: string, availableToolsCount: number): PlanStepItem[] {
  const clean = promptText.trim();
  const steps: PlanStepItem[] = [
    {
      id: 'plan_1',
      title: 'Analyze requirements & inspect context',
      detail: `Review "${clean.slice(0, 64)}${clean.length > 64 ? '…' : ''}"`,
      done: false,
    },
  ];
  if (/\b(github|repo|branch|commit|push)\b/i.test(clean) && availableToolsCount > 0) {
    steps.push({
      id: 'plan_2',
      title: 'Inspect repository & gather MCP context',
      detail: 'Run read-only MCP lookups first',
      done: false,
    });
  }
  steps.push({
    id: 'plan_3',
    title: /\b(app|website|html|ui|dashboard|code|refactor)\b/i.test(clean)
      ? 'Generate modular Pro Canvas application / code'
      : /\b(pdf|docx|pptx|xlsx|report|deck|excel)\b/i.test(clean)
        ? 'Generate structured Document Studio artifact'
        : 'Execute core tasks with approval gates',
    detail: 'Follow strict output quality and interactivity rules',
    done: false,
  });
  steps.push({
    id: 'plan_4',
    title: 'Verify output & summarize results',
    detail: 'Validate constraints and present next actions',
    done: false,
  });
  return steps;
}

export function buildPlanGuidedPrompt(userPrompt: string, steps: PlanStepItem[]): string {
  const numbered = steps
    .map((s, idx) => `${idx + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ''}`)
    .join('\n');
  return `${userPrompt}\n\n[APPROVED EXECUTION PLAN — FOLLOW IN ORDER]\n${numbered}`;
}
