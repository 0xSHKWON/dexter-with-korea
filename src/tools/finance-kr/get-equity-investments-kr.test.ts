import { describe, it, expect } from 'bun:test';
import { normalizeInvestments } from './get-equity-investments-kr.js';

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    inv_prm: '테스트법인',
    invstmnt_purps: '경영참여',
    trmend_blce_qy: '1,000',
    trmend_blce_qota_rt: '35',
    trmend_blce_acntbk_amount: '1,000,000',
    incrs_dcrs_acqs_dsps_qy: '-',
    recent_bsns_year_fnnr_sttus_tot_assets: '2,000,000',
    recent_bsns_year_fnnr_sttus_thstrm_ntpf: '-100,000',
    stlm_dt: '2025.12.31',
    ...overrides,
  };
}

describe('normalizeInvestments', () => {
  it('parses comma-grouped numbers and "-" placeholders', () => {
    const { rows } = normalizeInvestments(
      [row({ inv_prm: '엘지전자(주)', trmend_blce_qy: '57,278,451', trmend_blce_qota_rt: '35' })],
      100,
    );
    expect(rows[0].name).toBe('엘지전자(주)');
    expect(rows[0].shares).toBe(57_278_451);
    expect(rows[0].ratioPct).toBe(35);
    expect(rows[0].bookValue).toBe(1_000_000);
    expect(rows[0].sharesChange).toBeNull(); // '-' placeholder
    expect(rows[0].investee.netIncome).toBe(-100_000);
    expect(rows[0].investee.fiscalDate).toBe('2025.12.31');
  });

  it('sorts by term-end book value descending with nulls last, and truncates keeping the largest', () => {
    const { rows, totalCount } = normalizeInvestments(
      [
        row({ inv_prm: '소형', trmend_blce_acntbk_amount: '100' }),
        row({ inv_prm: '무장부가', trmend_blce_acntbk_amount: '-' }),
        row({ inv_prm: '대형', trmend_blce_acntbk_amount: '9,000' }),
        row({ inv_prm: '중형', trmend_blce_acntbk_amount: '500' }),
      ],
      2,
    );
    expect(totalCount).toBe(4);
    expect(rows.map((r) => r.name)).toEqual(['대형', '중형']);
  });

  it('drops 합계 total rows and blank names so sums are not double-counted', () => {
    const { rows, totalCount } = normalizeInvestments(
      [row({ inv_prm: '실제법인' }), row({ inv_prm: '합 계' }), row({ inv_prm: '합계' }), row({ inv_prm: '' })],
      100,
    );
    expect(totalCount).toBe(1);
    expect(rows[0].name).toBe('실제법인');
  });
});
