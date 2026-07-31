/**
 * Regression tests for gate bypasses found reviewing the upstream v1.0.3 merge.
 * Each case is an input that reached `allow` (or skipped the built-in floor) before
 * the fix, with only the allow rule the "always allow" flow would itself mint.
 */
import { describe, expect, it } from 'bun:test';
import { evaluateBash } from './engine.js';
import { parseCommand } from './command-parser.js';
import { builtinDeny, parseRule, proposeRule, type RuleSet, type ShellRule } from './rules.js';

function rules(allow: string[]): RuleSet {
  return {
    allow: allow.map(parseRule).filter((r): r is ShellRule => r !== null),
    ask: [],
    deny: [],
    defaultBashDecision: 'ask',
  };
}

const seg = (command: string) => parseCommand(command).segments[0];

describe('command-less segments are not dropped', () => {
  // buildSegment reduces `> file` / `PATH=x` to command === '', and the old filter
  // deleted them — so the matcher and the floor never saw effects that still ran.
  it('keeps a redirect-only segment visible so it cannot ride an allow rule', () => {
    expect(evaluateBash('ls && > /tmp/victim.txt', rules(['Bash(ls:*)'])).mode).toBe('ask');
  });

  it('denies an env-only segment that hijacks command resolution', () => {
    for (const command of ['PATH=/tmp/evil; ls', 'LD_PRELOAD=/tmp/x.so; ls', 'BASH_ENV=/tmp/x; ls']) {
      expect(evaluateBash(command, rules(['Bash(ls:*)'])).mode).toBe('deny');
    }
  });

  it('applies the secret floor to a redirect target', () => {
    expect(builtinDeny(seg('echo x > .env')).denied).toBe(true);
    expect(evaluateBash('ls && > .env', rules(['Bash(ls:*)'])).mode).toBe('deny');
  });
});

describe('proposeRule never widens to a destructive sibling', () => {
  // find/sort/tree are read-only as invoked but turn destructive with a flag, so a
  // bare `Bash(find:*)` would have covered `find -delete` and `find -exec rm`.
  it('offers the exact command for flag-dependent read-only commands', () => {
    expect(proposeRule(seg('find . -type f -name x'))).toBe('Bash(find . -type f -name x)');
    expect(proposeRule(seg('sort data.txt'))).toBe('Bash(sort data.txt)');
    expect(proposeRule(seg('tree'))).toBe('Bash(tree)');
  });

  it('still offers a wildcard where it is genuinely safe', () => {
    expect(proposeRule(seg('ls -la'))).toBe('Bash(ls:*)');
    expect(proposeRule(seg('git status'))).toBe('Bash(git status:*)');
  });

  it('still offers the exact command for a mutating one', () => {
    expect(proposeRule(seg('rm important.txt'))).toBe('Bash(rm important.txt)');
  });
});

describe('allow rules cannot be widened by what they do not express', () => {
  it('does not let an env prefix ride a matching rule', () => {
    // GIT_EXTERNAL_DIFF runs an arbitrary binary per changed file.
    expect(evaluateBash('GIT_EXTERNAL_DIFF=/tmp/evil.sh git diff', rules(['Bash(git diff:*)'])).mode).toBe('ask');
  });

  it('does not let a path-qualified command word inherit a basename rule', () => {
    expect(evaluateBash('/tmp/evil/ls -la', rules(['Bash(ls:*)'])).mode).toBe('ask');
    expect(evaluateBash('./ls', rules(['Bash(ls:*)'])).mode).toBe('ask');
  });

  it('leaves ordinary matches alone', () => {
    expect(evaluateBash('ls -la', rules(['Bash(ls:*)'])).mode).toBe('allow');
    expect(evaluateBash('git status', rules(['Bash(git status:*)'])).mode).toBe('allow');
    expect(evaluateBash('ls && pwd', rules(['Bash(ls:*)', 'Bash(pwd:*)'])).mode).toBe('allow');
  });
});

describe('flag spellings that write', () => {
  it('classifies =-joined and attached write flags as mutating', () => {
    expect(evaluateBash('sort --output=/tmp/x f', rules([])).classification).toBe('mutating');
    expect(evaluateBash('sort -o/tmp/x f', rules([])).classification).toBe('mutating');
    expect(evaluateBash('tree -o /tmp/x', rules([])).classification).toBe('mutating');
  });

  it('still treats the read-only spelling as read-only', () => {
    expect(evaluateBash('sort data.txt', rules([])).classification).toBe('read-only');
    expect(evaluateBash('tree', rules([])).classification).toBe('read-only');
  });
});

describe('rule grammar', () => {
  it('rejects an empty wildcard instead of promoting it to tool-wide', () => {
    expect(parseRule('Bash(:*)')).toBeNull();
    expect(parseRule('Bash')).toEqual({ kind: 'toolwide', raw: 'Bash' });
  });
});
