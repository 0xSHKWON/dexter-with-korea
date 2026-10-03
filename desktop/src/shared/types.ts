/** Types shared across main, preload, and renderer. Pure types only. */
import type { SidecarToMain, ConvertResult, ConversionRecord, ChatConversation, UserAnswers } from './sidecar';

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderMeta {
  id: string;
  displayName: string;
  /** Short column title in the model picker (e.g. "Claude", "Codex"). */
  shortName?: string;
  apiKeyEnvVar?: string;
  /** 'oauth' = ChatGPT-plan login; 'cli' = the user's logged-in Claude Code. */
  authType?: 'apiKey' | 'oauth' | 'cli';
  requiresKey: boolean;
  defaultModel: string;
  models: ModelOption[];
  /** Reasoning-effort levels this provider accepts, lowest first. Absent = no effort control. */
  effortLevels?: string[];
  note?: string;
}

/** Subscription-login state, read from the core's auth.json. Never carries tokens. */
export interface OAuthStatus {
  loggedIn: boolean;
  email?: string;
  plan?: string;
  /** 'dexter' = logged in here; 'codex-cli' = sharing the Codex CLI login. */
  source?: 'dexter' | 'codex-cli';
  /** An existing `codex login` (ChatGPT mode) was found and can be reused. */
  cliAvailable?: boolean;
  cliEmail?: string;
}

/** The local Claude Code CLI: installed, and logged in with its own `claude auth login`. */
export interface ClaudeCodeStatus {
  installed: boolean;
  loggedIn: boolean;
  /** Resolved `claude` binary (custom path setting or auto-detected). */
  path?: string;
  version?: string;
  email?: string;
  /** "claude.ai" (subscription) | "api_key" | … — from `claude auth status`. */
  authMethod?: string;
  /** "firstParty" | "bedrock" | "vertex" | … */
  apiProvider?: string;
  orgName?: string;
  /** "pro" | "max" | … */
  subscriptionType?: string;
}

export type AuthLoginResult = { ok: true; email?: string; plan?: string } | { ok: false; error: string };

export type DataSourceGroup = 'kr' | 'search' | 'other';

/** A non-LLM API key the agent core reads from process.env (DART, KRX, search, …). */
export interface DataSource {
  envVar: string;
  label: string;
  group: DataSourceGroup;
  note?: string;
}

export interface SecretStatus {
  envVar: string;
  exists: boolean;
  /** Last 4 chars of the stored key for visual confirmation; null if undecryptable. */
  last4: string | null;
  updatedAt: number | null;
}

/** Outcome of an .env export. Deliberately carries no key values. */
export interface SecretExportResult {
  /** Env var names written to the clipboard. */
  exported: string[];
  /** Stored but undecryptable — the user must re-enter these. */
  undecryptable: string[];
  copied: boolean;
}

export interface AppSettings {
  provider?: string;
  modelId?: string;
  /** providerId → chosen reasoning effort; a missing entry means the provider default. */
  effort?: Record<string, string>;
  [key: string]: unknown;
}

export type UpdateStatus = 'ok' | 'optional' | 'required';

export interface UpdateInfo {
  /** ok = up to date; optional = newer available; required = below minimum, lock the app. */
  status: UpdateStatus;
  current: string;
  latest: string | null;
  /** Download / Releases page to open. */
  url: string;
  notes: string;
}

/** electron-updater progress, pushed from main (Windows in-app auto-update). */
export interface AutoUpdateStatus {
  state: 'checking' | 'downloading' | 'downloaded' | 'none' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

/** API surface exposed to the renderer via contextBridge as `window.dexter`. */
/** One answered chat turn, ready to print. `answerHtml` is already-rendered markdown. */
export interface ChatPdfDoc {
  title: string;
  question: string;
  answerHtml: string;
  askedAt?: number;
  answeredAt?: number;
  /** Tool calls the agent made ("재무제표 조회 · 005930"), listed as the report's data trail. */
  sources: string[];
}

export interface ChatPdfResult {
  saved: boolean;
  path?: string;
}

export interface DexterApi {
  providers: {
    list(): Promise<ProviderMeta[]>;
  };
  datasources: {
    list(): Promise<DataSource[]>;
  };
  auth: {
    /** ChatGPT (Codex) login state. */
    status(): Promise<OAuthStatus>;
    /** Run the login; resolves when it finishes. The device code arrives as an `auth_prompt` chat event. */
    login(mode: 'browser' | 'device'): Promise<AuthLoginResult>;
    cancel(): Promise<void>;
    logout(): Promise<void>;
    /** Reuse the existing Codex CLI login instead of logging in again. */
    linkCodexCli(): Promise<AuthLoginResult>;
  };
  claudeCode: {
    status(): Promise<ClaudeCodeStatus>;
    /** Runs `claude auth login` (opens the browser); resolves when it exits. */
    login(): Promise<AuthLoginResult>;
    cancel(): Promise<void>;
  };
  settings: {
    getAll(): Promise<AppSettings>;
    set(key: string, value: unknown): Promise<void>;
  };
  secrets: {
    statusAll(): Promise<SecretStatus[]>;
    set(envVar: string, value: string): Promise<SecretStatus>;
    remove(envVar: string): Promise<void>;
    encryptionAvailable(): Promise<boolean>;
    /** Copy every stored key to the clipboard as .env lines. */
    exportEnv(): Promise<SecretExportResult>;
  };
  chat: {
    send(query: string): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    /** Reply to a `question` sidecar message (ask_user_question). */
    answer(questionId: string, answers: UserAnswers): Promise<void>;
    /** Subscribe to sidecar messages; returns an unsubscribe function. Shared by chat + work. */
    onEvent(cb: (msg: SidecarToMain) => void): () => void;
    /** Clear the sidecar's in-memory history (new/switched chat). */
    reset(): Promise<void>;
    listConversations(): Promise<ChatConversation[]>;
    saveConversation(conv: ChatConversation): Promise<void>;
    deleteConversation(id: string): Promise<void>;
    /** Save-dialog → A4 PDF of one answer, opened in the default viewer once written. */
    exportPdf(doc: ChatPdfDoc): Promise<ChatPdfResult>;
  };
  work: {
    /** Convert pasted ledger data into DART standard accounts. Result arrives via chat.onEvent. */
    convert(rawData: string): Promise<{ runId: string }>;
    /** Abort an in-flight conversion. */
    cancel(runId: string): Promise<void>;
    /** Export a converted result to a styled .xlsx via a save dialog. */
    export(result: ConvertResult): Promise<{ saved: boolean; path?: string }>;
    /** Archive a conversion to the local DB. */
    save(raw: string, result: ConvertResult): Promise<ConversionRecord>;
    /** List archived conversions (newest first). */
    list(): Promise<ConversionRecord[]>;
    /** Delete an archived conversion. */
    delete(id: string): Promise<void>;
  };
  update: {
    /** Check the remote manifest against this build's version. */
    check(): Promise<UpdateInfo>;
    /** Open the download/Releases page in the OS browser. */
    open(url: string): Promise<void>;
    /** Quit and install a downloaded update (Windows auto-update). */
    install(): Promise<void>;
    /** Subscribe to electron-updater progress (Windows); returns unsubscribe. */
    onStatus(cb: (s: AutoUpdateStatus) => void): () => void;
  };
}
