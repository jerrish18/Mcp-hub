import type { SavedPrompt } from '../types';

export function composerCommand(input: string): { mode: 'resource' | 'prompt'; query: string } | undefined {
  const match = /(?:^|\s)([@/])([^\s]*)$/.exec(input);
  return match ? { mode: match[1] === '@' ? 'resource' : 'prompt', query: match[2] } : undefined;
}

export function removeComposerCommand(input: string): string {
  return input.replace(/(?:^|\s)[@/][^\s]*$/, '').trimEnd();
}

export function compareCommand(input: string): string | undefined {
  const match = /^\s*\/compare(?:\s+([\s\S]*))?$/i.exec(input);
  return match ? (match[1] ?? '').trim() : undefined;
}

export function matchingPromptMacros(items: SavedPrompt[], query: string): SavedPrompt[] {
  const search = query.trim().toLowerCase().replaceAll('-', ' ');
  return items.filter((item) => [item.title, item.category].some((value) => value?.toLowerCase().replaceAll('-', ' ').includes(search))).slice(0, 12);
}
