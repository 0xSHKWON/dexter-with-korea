import { describe, it, expect } from 'bun:test';
import { buildKoreanResearchSection } from './prompts.js';

describe('buildKoreanResearchSection tiering', () => {
  it('returns the full DART-backed playbook when a DART key is present', () => {
    const s = buildKoreanResearchSection(true);
    expect(s).toContain('your edge over generic assistants');
    expect(s).toContain('get_financials_kr'); // full tier drives the DART tools
    expect(s).toContain('get_large_holders_kr');
  });

  it('returns the keyless tier — pointing at NO unbound DART tools — without a DART key', () => {
    const s = buildKoreanResearchSection(false);
    expect(s).toContain('keyless market-data edge');
    expect(s).toContain('get_market_data_kr'); // always-registered Naver tools
    expect(s).toContain('get_foreign_ownership_kr');
    expect(s).not.toContain('get_financials_kr'); // DART tools are not bound here
    expect(s).not.toContain('get_large_holders_kr');
    expect(s).not.toContain('read_filings_kr');
    expect(s.length).toBeGreaterThan(0); // never empty — the keyless tools always exist
  });
});
