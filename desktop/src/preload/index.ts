import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DexterApi } from '../shared/types';
import type { SidecarToMain } from '../shared/sidecar';

const api: DexterApi = {
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
  },
  datasources: {
    list: () => ipcRenderer.invoke('datasources:list'),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },
  secrets: {
    statusAll: () => ipcRenderer.invoke('secrets:statusAll'),
    set: (envVar, value) => ipcRenderer.invoke('secrets:set', envVar, value),
    remove: (envVar) => ipcRenderer.invoke('secrets:remove', envVar),
    encryptionAvailable: () => ipcRenderer.invoke('secrets:encryptionAvailable'),
  },
  chat: {
    send: (query) => ipcRenderer.invoke('chat:send', query),
    cancel: (runId) => ipcRenderer.invoke('chat:cancel', runId),
    onEvent: (cb) => {
      const listener = (_e: IpcRendererEvent, msg: SidecarToMain) => cb(msg);
      ipcRenderer.on('chat:event', listener);
      return () => ipcRenderer.off('chat:event', listener);
    },
    reset: () => ipcRenderer.invoke('chat:reset'),
    listConversations: () => ipcRenderer.invoke('chat:listConv'),
    saveConversation: (conv) => ipcRenderer.invoke('chat:saveConv', conv),
    deleteConversation: (id) => ipcRenderer.invoke('chat:deleteConv', id),
  },
  work: {
    convert: (rawData) => ipcRenderer.invoke('work:convert', rawData),
    export: (result) => ipcRenderer.invoke('work:export', result),
    save: (raw, result) => ipcRenderer.invoke('work:save', raw, result),
    list: () => ipcRenderer.invoke('work:list'),
    delete: (id) => ipcRenderer.invoke('work:delete', id),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    open: (url) => ipcRenderer.invoke('update:open', url),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const listener = (_e: IpcRendererEvent, s: Parameters<typeof cb>[0]): void => cb(s);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.off('update:status', listener);
    },
  },
};

contextBridge.exposeInMainWorld('dexter', api);
