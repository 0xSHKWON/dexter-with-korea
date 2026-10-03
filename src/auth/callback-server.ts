import { createServer, type Server } from 'node:http';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const PAGE = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font-family:-apple-system,system-ui,sans-serif;background:#141414;color:#eee;` +
  `display:flex;align-items:center;justify-content:center;height:100vh;margin:0}` +
  `div{text-align:center}p{color:#999}</style></head><body><div><h2>${title}</h2><p>${body}</p></div></body></html>`;

export interface CallbackWaitOptions {
  port: number;
  path: string;
  /** The `state` sent in the authorize URL; a mismatching callback is rejected. */
  state: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CallbackServer {
  /** Resolves with the authorization code once the provider redirects back. */
  code: Promise<string>;
  close(): void;
}

/**
 * Listen on a fixed loopback port for the OAuth redirect. Uses node:http (not
 * Bun.serve) so the same code runs under the Bun core and any Node host.
 *
 * The port is not negotiable: OpenAI only accepts the exact registered
 * redirect_uri, so falling back to a random port would fail the token exchange.
 */
export async function startCallbackServer(opts: CallbackWaitOptions): Promise<CallbackServer> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const code = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  // The caller may race this against cancellation; don't surface an unhandled rejection.
  code.catch(() => {});

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${opts.port}`);
    if (url.pathname !== opts.path) {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const returnedCode = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (error) {
      const desc = url.searchParams.get('error_description') ?? error;
      res.writeHead(400).end(PAGE('로그인 실패', 'Dexter로 돌아가 다시 시도해 주세요.'));
      rejectCode(new Error(`OAuth error: ${desc}`));
      return;
    }
    if (!returnedCode || returnedState !== opts.state) {
      res.writeHead(400).end(PAGE('잘못된 요청', 'state가 일치하지 않습니다.'));
      rejectCode(new Error('OAuth callback state mismatch'));
      return;
    }
    res.writeHead(200).end(PAGE('로그인 완료', '이 창을 닫고 Dexter로 돌아가세요.'));
    resolveCode(returnedCode);
  });

  await new Promise<void>((res, rej) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      rej(
        err.code === 'EADDRINUSE'
          ? new Error(
              `Port ${opts.port} is already in use (another Codex/Dexter login running?). ` +
                'Close it or use the device-code login instead.',
            )
          : err,
      );
    });
    server.listen(opts.port, '127.0.0.1', () => res());
  });

  const timer = setTimeout(
    () => rejectCode(new Error('Login timed out — no browser callback received')),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onAbort = () => rejectCode(new Error('Login cancelled'));
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  const close = () => {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    server.close();
    server.closeAllConnections?.();
  };
  code.finally(close).catch(() => {});

  return { code, close };
}
