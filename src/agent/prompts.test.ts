import { describe, it, expect } from 'bun:test';
import { buildKoreanResearchSection, buildKrRoutingBullet } from './prompts.js';

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

describe('buildKrRoutingBullet', () => {
  it('keyless tier names NO DART-gated tools but keeps the always-registered ones', () => {
    const b = buildKrRoutingBullet(false);
    expect(b).not.toContain('get_financials_kr');
    expect(b).not.toContain('get_filings_kr');
    expect(b).not.toContain('read_filings_kr');
    expect(b).not.toContain('get_segments_kr');
    expect(b).toContain('get_market_data_kr');
    expect(b).toContain('get_consensus_kr');
    expect(b).toContain('get_price_history_kr');
    expect(b).toContain('get_foreign_ownership_kr');
  });

  it('full tier names the DART tools too', () => {
    const b = buildKrRoutingBullet(true);
    expect(b).toContain('get_financials_kr');
    expect(b).toContain('read_filings_kr');
    expect(b).toContain('get_consensus_kr');
  });
});
