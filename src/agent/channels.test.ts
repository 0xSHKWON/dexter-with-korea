/**
 * The desktop sidecar declared no channel, so getChannelProfile fell back to CLI
 * and the primary product's answers were shaped for a terminal: short, no markdown
 * headers, tickers instead of company names. These pin the desktop profile and,
 * just as importantly, that adding it changed nothing for the upstream channels.
 */
import { describe, expect, it } from 'bun:test';
import { getChannelProfile } from './channels.js';

const CLI_ONLY_RULES = ['Do not use markdown headers', 'Tickers not names'];

describe('desktop channel profile', () => {
  const desktop = getChannelProfile('desktop');

  it('is its own profile, not the CLI fallback', () => {
    expect(desktop.label).toBe('Desktop');
    expect(desktop).not.toBe(getChannelProfile('cli'));
  });

  it('drops the terminal-shaped formatting rules', () => {
    const text = [desktop.preamble, ...desktop.responseFormat, desktop.tables ?? ''].join('\n');
    expect(CLI_ONLY_RULES.filter((rule) => text.includes(rule))).toEqual([]);
    expect(desktop.preamble).not.toContain('command line interface');
  });

  it('renders tables, unlike WhatsApp', () => {
    expect(desktop.tables).toBeTruthy();
    expect(getChannelProfile('whatsapp').tables).toBeNull();
  });

  // Observed in a real answer: `**영업이익률 71.5%**와` rendered with literal
  // asterisks. CommonMark will not close emphasis when the span ends in
  // punctuation and a letter follows, and in Korean a particle almost always
  // follows a percentage — so the profile has to say how to write it.
  it('tells the model how to bold a percentage followed by a Korean particle', () => {
    const rules = desktop.responseFormat.join('\n');
    expect(rules).toContain('**71.5%와**');
    expect(rules).toContain('not **71.5%**와');
  });

  it('keeps the correctness rules that are not about formatting', () => {
    const behavior = desktop.behavior.join('\n');
    expect(behavior).toContain('as-of date/period');
    expect(behavior).toContain('Prioritize accuracy over validation');
    // Runs are single-shot here (src/sidecar/index.ts) — the answer must stand alone.
    expect(behavior).toContain('no earlier conversation');
  });
});

describe('upstream channels are untouched', () => {
  it('cli still carries its own rules', () => {
    const cli = getChannelProfile('cli');
    const text = [...cli.responseFormat, cli.tables ?? ''].join('\n');
    expect(CLI_ONLY_RULES.filter((rule) => text.includes(rule))).toEqual(CLI_ONLY_RULES);
    expect(cli.preamble).toContain('command line interface');
  });

  it('an unknown channel still falls back to cli', () => {
    expect(getChannelProfile('eval')).toBe(getChannelProfile('cli'));
    expect(getChannelProfile(undefined)).toBe(getChannelProfile('cli'));
  });
});
