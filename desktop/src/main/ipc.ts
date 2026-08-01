import { randomUUID } from 'node:crypto';
import { ipcMain, clipboard, dialog, shell, BrowserWindow } from 'electron';
import ExcelJS from 'exceljs';
import { checkForUpdate } from './updater';
import { PROVIDERS, getProviderById } from './providers';
import { DATA_SOURCES } from './data-sources';
import type {
  ConvertResult,
  AccountMapping,
  ConversionRecord,
  ChatConversation,
  StoredMessage,
  UserAnswers,
} from '../shared/sidecar';
import {
  getAllSettings,
  getSetting,
  setSetting,
  getSecret,
  setSecret,
  deleteSecret,
  getSecretUpdatedAt,
  insertConversion,
  listConversionRows,
  deleteConversion,
  upsertChat,
  listChatRows,
  deleteChat,
} from './db';
import { encryptSecret, decryptSecret, previewLast4, isEncryptionAvailable } from './secrets';
import { sidecar } from './sidecar';
import type { SecretStatus, SecretExportResult } from '../shared/types';

function statusFor(envVar: string): SecretStatus {
  const buf = getSecret(envVar);
  if (!buf) return { envVar, exists: false, last4: null, updatedAt: null };
  // A stored row is not a usable key. safeStorage is bound to the OS keychain, so
  // a re-signed build can leave rows that no longer decrypt — and sidecar.ts skips
  // those silently when injecting env. Reporting `exists` from row presence alone
  // showed every key green while every run failed with "API_KEY not found".
  const last4 = previewLast4(buf);
  // Empty is unusable too — it would be injected as an empty env var and 401.
  if (!last4) return { envVar, exists: false, last4: null, updatedAt: null };
  return {
    envVar,
    exists: true,
    last4,
    updatedAt: getSecretUpdatedAt(envVar),
  };
}

const DEFAULT_PROVIDER_ID = 'openai';

/**
 * Provider + model for a sidecar run. The model falls back to the provider's
 * catalog default rather than a hardcoded id: hardcoding it here meant retiring a
 * model in providers.ts left the runtime silently pointing at the old one, so the
 * Settings screen and the model actually used could disagree on a fresh install.
 */
function resolveRun(): { provider: string; model: string } {
  const provider = getSetting<string>('provider', DEFAULT_PROVIDER_ID);
  const fallback =
    getProviderById(provider)?.defaultModel ??
    getProviderById(DEFAULT_PROVIDER_ID)?.defaultModel ??
    '';
  return { provider, model: getSetting<string>('modelId', fallback) };
}

export function registerIpc(): void {
  ipcMain.handle('providers:list', () => PROVIDERS);
  ipcMain.handle('datasources:list', () => DATA_SOURCES);

  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:open', (_e, url: string) => shell.openExternal(url));

  ipcMain.handle('settings:getAll', () => getAllSettings());
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    setSetting(key, value);
  });

  ipcMain.handle('secrets:statusAll', () => {
    const envVars = [
      ...PROVIDERS.filter((p) => p.apiKeyEnvVar).map((p) => p.apiKeyEnvVar as string),
      ...DATA_SOURCES.map((d) => d.envVar),
    ];
    return envVars.map(statusFor);
  });
  ipcMain.handle('secrets:set', (_e, envVar: string, value: string): SecretStatus => {
    const trimmed = (value ?? '').trim();
    if (!trimmed) throw new Error('API key is empty');
    setSecret(envVar, encryptSecret(trimmed));
    sidecar.stop(); // respawn with fresh keys on next request
    return statusFor(envVar);
  });
  ipcMain.handle('secrets:remove', (_e, envVar: string) => {
    deleteSecret(envVar);
    sidecar.stop();
  });
  ipcMain.handle('secrets:encryptionAvailable', () => isEncryptionAvailable());

  // Copy every stored key as .env lines, for pasting into the CLI's .env.
  //
  // Decryption and formatting stay in the main process and the text goes straight
  // to the clipboard: plaintext keys must never cross to the renderer, which today
  // only ever sees `exists` + last-4 (see statusFor). The return value is counts
  // and env-var names only.
  ipcMain.handle('secrets:exportEnv', (): SecretExportResult => {
    const envVars = [
      ...PROVIDERS.filter((p) => p.apiKeyEnvVar).map((p) => p.apiKeyEnvVar as string),
      ...DATA_SOURCES.map((d) => d.envVar),
    ];

    const lines: string[] = [];
    const exported: string[] = [];
    const undecryptable: string[] = [];

    for (const envVar of envVars) {
      const buf = getSecret(envVar);
      if (!buf) continue;
      let value: string;
      try {
        value = decryptSecret(buf);
      } catch {
        undecryptable.push(envVar);
        continue;
      }
      if (!value) continue;
      lines.push(`${envVar}=${value}`);
      exported.push(envVar);
    }

    if (lines.length === 0) return { exported: [], undecryptable, copied: false };

    clipboard.writeText(`${lines.join('\n')}\n`);
    return { exported, undecryptable, copied: true };
  });

  // ── chat (sidecar) ────────────────────────────────────────────────────────
  ipcMain.handle('chat:send', (_e, query: string) => {
    const { provider, model } = resolveRun();
    const runId = randomUUID();
    sidecar.send({ type: 'run', id: runId, query, model, modelProvider: provider });
    return { runId };
  });
  ipcMain.handle('chat:cancel', (_e, runId: string) => {
    sidecar.send({ type: 'cancel', id: runId });
  });
  ipcMain.handle('chat:answer', (_e, questionId: string, answers: UserAnswers) => {
    sidecar.send({ type: 'answer', questionId, answers });
  });
  ipcMain.handle('chat:reset', () => {
    sidecar.send({ type: 'reset' });
  });
  ipcMain.handle('chat:listConv', (): ChatConversation[] =>
    listChatRows().map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      title: r.title,
      messages: JSON.parse(r.messages) as StoredMessage[],
    })),
  );
  ipcMain.handle('chat:saveConv', (_e, conv: ChatConversation) => {
    upsertChat({
      id: conv.id,
      created_at: conv.createdAt,
      updated_at: Date.now(),
      title: conv.title,
      messages: JSON.stringify(conv.messages),
    });
  });
  ipcMain.handle('chat:deleteConv', (_e, id: string) => {
    deleteChat(id);
  });

  // ── work (ledger → DART accounts) ─────────────────────────────────────────
  ipcMain.handle('work:convert', (_e, rawData: string) => {
    const { provider, model } = resolveRun();
    const runId = randomUUID();
    sidecar.send({ type: 'convert', id: runId, rawData, model, modelProvider: provider });
    return { runId };
  });

  ipcMain.handle('work:cancel', (_e, runId: string) => {
    sidecar.send({ type: 'cancel', id: runId });
  });
  ipcMain.handle('work:save', (_e, raw: string, result: ConvertResult): ConversionRecord => {
    const id = randomUUID();
    const createdAt = Date.now();
    const first = result.mappings[0]?.standard;
    const title = `${result.mappings.length}개 계정${first ? ` · ${first}` : ''}`;
    insertConversion({ id, created_at: createdAt, title, raw, result: JSON.stringify(result) });
    return { id, createdAt, title, raw, result };
  });
  ipcMain.handle('work:list', (): ConversionRecord[] =>
    listConversionRows().map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      title: r.title,
      raw: r.raw,
      result: JSON.parse(r.result) as ConvertResult,
    })),
  );
  ipcMain.handle('work:delete', (_e, id: string) => {
    deleteConversion(id);
  });

  ipcMain.handle('work:export', async (_e, result: ConvertResult) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = {
      defaultPath: 'dart-재무제표.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return { saved: false };
    await buildWorkbook(result, filePath);
    return { saved: true, path: filePath };
  });
}

const STMT_NAMES: Record<string, string> = {
  BS: '재무상태표',
  IS: '손익계산서',
  CF: '현금흐름표',
  기타: '기타',
};
const STMT_ORDER = ['BS', 'IS', 'CF', '기타'];

/** Build a styled .xlsx (one sheet per statement) from the converted mappings. */
async function buildWorkbook(result: ConvertResult, filePath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const groups: Record<string, AccountMapping[]> = {};
  for (const m of result.mappings) {
    (groups[m.statement || '기타'] ??= []).push(m);
  }
  const keys = [
    ...STMT_ORDER.filter((k) => groups[k]),
    ...Object.keys(groups).filter((k) => !STMT_ORDER.includes(k)),
  ];

  for (const stmt of keys) {
    const rows = groups[stmt];
    const ws = wb.addWorksheet(STMT_NAMES[stmt] ?? stmt);
    ws.columns = [
      { header: '표준계정과목', key: 'standard', width: 24 },
      { header: '금액', key: 'amount', width: 18 },
      { header: '원본계정', key: 'original', width: 18 },
      { header: '비고', key: 'note', width: 50 },
    ];

    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEFF2' } };

    for (const r of rows) {
      ws.addRow({ standard: r.standard, amount: r.amount, original: r.original, note: r.note });
    }

    const amountCol = ws.getColumn('amount');
    amountCol.numFmt = '#,##0';
    amountCol.alignment = { horizontal: 'right' };
    ws.getColumn('note').alignment = { wrapText: true, vertical: 'top' };

    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      });
    });
  }

  if (result.warnings.length > 0) {
    const ws = wb.addWorksheet('검토사항');
    ws.columns = [{ header: '검토 필요 사항', key: 'w', width: 90 }];
    ws.getRow(1).font = { bold: true };
    for (const w of result.warnings) {
      const row = ws.addRow({ w });
      row.getCell('w').alignment = { wrapText: true };
    }
  }

  await wb.xlsx.writeFile(filePath);
}
