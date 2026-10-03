/**
 * A minimal in-process MCP server (Streamable HTTP, JSON responses only) that
 * exposes Dexter's tools to a Claude Code session.
 *
 * In-process on purpose: tool calls run inside the Dexter process, through the
 * same AgentToolExecutor as the native loop, so approval prompts, progress
 * events, ask_user_question, and the scratchpad all keep working.
 *
 * Bound to 127.0.0.1 on a random port and guarded by a per-run bearer token.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpServerHandle {
  url: string;
  token: string;
  close(): void;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const SERVER_INFO = { name: 'dexter', version: '1.0.0' };
const FALLBACK_PROTOCOL = '2025-06-18';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function startMcpServer(
  tools: McpToolDef[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>,
): Promise<McpServerHandle> {
  const token = randomBytes(24).toString('hex');

  async function handle(msg: JsonRpcRequest): Promise<object | null> {
    const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });

    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: (msg.params?.protocolVersion as string) ?? FALLBACK_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools });
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (!tools.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        const r = await callTool(name, args);
        return reply({ content: [{ type: 'text', text: r.text }], isError: r.isError ?? false });
      }
      default:
        // Notifications (no id) get no response; unknown requests get method-not-found.
        return msg.id === undefined || msg.id === null ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    if (req.method !== 'POST') {
      // No server-initiated stream; clients fall back to request/response.
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    let parsed: JsonRpcRequest | JsonRpcRequest[];
    try {
      parsed = JSON.parse(await readBody(req)) as JsonRpcRequest | JsonRpcRequest[];
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
      );
      return;
    }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    const responses = (await Promise.all(batch.map(handle))).filter((r): r is object => r !== null);
    if (responses.length === 0) {
      res.writeHead(202).end();
      return;
    }
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => {
      server.close();
      server.closeAllConnections?.();
    },
  };
}
