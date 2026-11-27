const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]'],
  [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [REDACTED]'],
  [/x-goog-api-key["'\s:=]+[A-Za-z0-9\-_]{16,}/gi, 'x-goog-api-key=[REDACTED]'],
  [/AIza[0-9A-Za-z\-_]{20,}/g, 'AIza[REDACTED]'],
  [/mcphub_live_[0-9A-Za-z\-_]{16,}/g, 'mcphub_live_[REDACTED]'],
  [/nvapi-[0-9A-Za-z_-]{16,}/g, 'nvapi-[REDACTED]'],
  [/gsk_[0-9A-Za-z]{16,}/g, 'gsk_[REDACTED]'],
  [/sk-or-v1-[0-9A-Za-z]{16,}/g, 'sk-or-v1-[REDACTED]'],
  [/sk-ant-[0-9A-Za-z\-_]{16,}/g, 'sk-ant-[REDACTED]'],
  [/sk-[0-9A-Za-z]{20,}/g, 'sk-[REDACTED]'],
  [/ghp_[0-9A-Za-z]{20,}/g, 'ghp_[REDACTED]'],
  [/github_pat_[0-9A-Za-z_]{20,}/g, 'github_pat_[REDACTED]'],
  [/xox[baprs]-[0-9A-Za-z-]{16,}/g, 'xox-[REDACTED]'],
  [/("?(?:access_token|refresh_token|client_secret|api_key|apiKey|password|authorization|token)"?\s*[:=]\s*"?)[^"\s,&}]+/gi, '$1[REDACTED]'],
  [/([?&](?:key|api_key|token|access_token|client_secret)=)[^&\s]+/gi, '$1[REDACTED]'],
];

export function redactSecrets(input: string, knownSecrets: string[] = []): string {
  let output = input;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 6) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function safeErrorMessage(error: unknown, knownSecrets: string[] = []): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unexpected error occurred';
  return redactSecrets(raw, knownSecrets);
}

export function assertSecureServerUrl(url: string): void {
  const trimmed = url.trim();
  if (
    !(
      trimmed.startsWith('https://') ||
      trimmed.startsWith('virtual://') ||
      trimmed.startsWith('http://localhost') ||
      trimmed.startsWith('http://127.0.0.1')
    )
  ) {
    throw new Error('Insecure URL rejected: remote MCP servers and OAuth endpoints must use HTTPS.');
  }
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) {
      throw new Error('URL is missing a valid hostname.');
    }
  } catch {
    throw new Error('Invalid server or OAuth URL.');
  }
}
