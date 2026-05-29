import { describe, it, expect, afterEach } from 'bun:test';
import { discoverSkills, getSkill, clearSkillCache } from './registry.js';

afterEach(() => {
  clearSkillCache();
});

describe('discoverSkills', () => {
  it('discovers all builtin skills with valid frontmatter', () => {
    const names = discoverSkills().map((s) => s.name);
    for (const expected of ['dcf-valuation', 'write-memo', 'x-research', 'kr-spinoff-analysis']) {
      expect(names).toContain(expected);
    }
  });

  it('gives every discovered skill a non-empty description', () => {
    for (const skill of discoverSkills()) {
      expect(skill.description.length).toBeGreaterThan(0);
    }
  });
});

describe('getSkill', () => {
  it('loads the KR split skill instructions', () => {
    const skill = getSkill('kr-spinoff-analysis');
    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain('물적분할');
  });

  it('references the KR sector WACC file from the dcf skill', () => {
    const skill = getSkill('dcf-valuation');
    expect(skill?.instructions).toContain('sector-wacc-kr.md');
  });
});
