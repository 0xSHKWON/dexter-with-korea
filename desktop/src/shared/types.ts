/** Types shared across main, preload, and renderer. Pure types only. */
import type { SidecarToMain, ConvertResult, ConversionRecord, ChatConversation } from './sidecar';

export interface ProviderMeta {
  id: string;
  displayName: string;
  apiKeyEnvVar?: string;
  requiresKey: boolean;
  defaultModel: string;
  suggestedModels: string[];
  note?: string;
}

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

export interface AppSettings {
  provider?: string;
  modelId?: string;
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

/** API surface exposed to the renderer via contextBridge as `window.dexter`. */
export interface DexterApi {
  providers: {
    list(): Promise<ProviderMeta[]>;
  };
  datasources: {
    list(): Promise<DataSource[]>;
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
  };
  chat: {
    send(query: string): Promise<{ runId: string }>;
    cancel(runId: string): Promise<void>;
    /** Subscribe to sidecar messages; returns an unsubscribe function. Shared by chat + work. */
    onEvent(cb: (msg: SidecarToMain) => void): () => void;
    /** Clear the sidecar's in-memory history (new/switched chat). */
    reset(): Promise<void>;
    listConversations(): Promise<ChatConversation[]>;
    saveConversation(conv: ChatConversation): Promise<void>;
    deleteConversation(id: string): Promise<void>;
  };
  work: {
    /** Convert pasted ledger data into DART standard accounts. Result arrives via chat.onEvent. */
    convert(rawData: string): Promise<{ runId: string }>;
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
  };
}
