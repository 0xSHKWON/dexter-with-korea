export interface OAuthCredentials {
  access: string;
  refresh: string;
  /** Epoch ms when `access` expires. */
  expires: number;
  accountId?: string;
  email?: string;
  /** ChatGPT plan type from the token claims (plus, pro, team, …). */
  plan?: string;
  /** 'codex-cli' = tokens live in Codex CLI's auth.json and are shared with it (see auth/codex-cli.ts). */
  source?: 'dexter' | 'codex-cli';
}

export interface OAuthAuthPrompt {
  /** Page the user must open. */
  url: string;
  /** Device flow only: the code to type on that page. */
  userCode?: string;
  instructions?: string;
}

export interface OAuthLoginCallbacks {
  onAuth(prompt: OAuthAuthPrompt): void;
  onProgress?(message: string): void;
  signal?: AbortSignal;
}

/** Providers that authenticate with a subscription login instead of an API key. */
export type OAuthProviderId = 'openai-codex';
