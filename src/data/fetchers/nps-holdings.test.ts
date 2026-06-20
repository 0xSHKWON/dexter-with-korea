import { describe, it, expect } from 'bun:test';
import { parseNpsRows } from './nps-holdings.js';

describe('parseNpsRows', () => {
  it('matches columns by substring (unit/spacing drift tolerant)', () => {
    const rows = [
      {
        번호: '1',
        종목명: '삼성전자',
        '평가액(억원)': '350,000',
        '자산군 내 비중(%)': '25.1',
        '지분율(%)': '7.5',
      },
    ];
    expect(parseNpsRows(rows)).toEqual([
      { name: '삼성전자', evalAmount: 350000, weightPct: 25.1, shareRatioPct: 7.5 },
    ]);
  });

  it('skips rows without a name', () => {
    expect(parseNpsRows([{ 번호: '2', '평가액(억원)': '10' }])).toEqual([]);
  });
});
