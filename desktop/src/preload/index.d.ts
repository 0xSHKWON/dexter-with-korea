import type { DexterApi } from '../shared/types';

declare global {
  interface Window {
    dexter: DexterApi;
  }
}

export {};
