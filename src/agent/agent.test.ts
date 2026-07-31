import { describe, expect, it } from 'bun:test';
import { Agent } from './agent.js';

/** `tools` is private, but which tools get bound is exactly what's under test. */
function toolNames(agent: Agent): string[] {
  return (agent as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
}

// bash is Unix-only (registry gates on process.platform).
const bashAvailable = process.platform !== 'win32';

describe('approval-gated tool binding', () => {
  // The desktop sidecar leaves `channel` unset — so it reads as CLI and the
  // CLI_ONLY_TOOLS filter does not fire — but wires no approval handler. The
  // executor then fails closed to 'deny', so binding these would give the model
  // tools whose every call is auto-denied.
  it('drops approval-gated tools when no handler is wired', async () => {
    const names = toolNames(await Agent.create({ memoryEnabled: false }));

    expect(names).not.toContain('bash');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('edit_file');
  });

  it('binds them when an approval handler is wired', async () => {
    const names = toolNames(
      await Agent.create({ memoryEnabled: false, requestToolApproval: async () => 'deny' }),
    );

    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    if (bashAvailable) expect(names).toContain('bash');
  });

  it('leaves non-gated tools alone either way', async () => {
    const names = toolNames(await Agent.create({ memoryEnabled: false }));

    expect(names).toContain('read_file');
    expect(names).toContain('get_market_data_kr');
  });

  // ask_user_question is CLI-only but not approval-gated: the sidecar wires
  // requestUserInput and renders the prompt itself, so it must survive.
  it('keeps ask_user_question on the desktop sidecar path', async () => {
    const names = toolNames(
      await Agent.create({
        memoryEnabled: false,
        requestUserInput: async () => ({ answers: [] }),
      }),
    );

    expect(names).toContain('ask_user_question');
  });

  it('does not advertise unbound tools in the system prompt', async () => {
    // Desktop shape: the prompt must not promise a tool the model cannot call, or
    // it plans around write_file and then fails every attempt.
    const agent = await Agent.create({ memoryEnabled: false });
    const prompt = (agent as unknown as { systemPrompt: string }).systemPrompt;

    for (const tool of ['write_file', 'edit_file', 'bash']) {
      expect({ tool, advertised: prompt.includes(`**${tool}**`) }).toEqual({ tool, advertised: false });
    }
    expect(prompt).not.toContain('use write_file or edit_file to modify');
    // Tools that ARE bound still get described.
    expect(prompt).toContain('**get_market_data_kr**');
  });

  it('advertises them when they are bound', async () => {
    const agent = await Agent.create({
      memoryEnabled: false,
      requestToolApproval: async () => 'deny',
    });
    const prompt = (agent as unknown as { systemPrompt: string }).systemPrompt;

    expect(prompt).toContain('**write_file**');
    expect(prompt).toContain('use write_file or edit_file to modify');
  });

  it('still drops CLI-only tools on a non-CLI channel', async () => {
    const names = toolNames(
      await Agent.create({
        memoryEnabled: false,
        channel: 'whatsapp',
        requestToolApproval: async () => 'deny',
      }),
    );

    expect(names).not.toContain('bash');
    expect(names).not.toContain('ask_user_question');
  });
});
