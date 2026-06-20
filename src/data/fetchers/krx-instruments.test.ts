import { describe, it, expect } from 'bun:test';
import { parseKrxInstruments } from './krx-instruments.js';

const SAMPLE = {
  OutBlock_1: [
    {
      ISU_CD: 'KR7005930003',
      ISU_SRT_CD: '005930',
      ISU_NM: '삼성전자보통주',
      ISU_ABBRV: '삼성전자',
      MKT_TP_NM: 'KOSPI',
    },
    {
      ISU_CD: 'KR7035420009',
      ISU_SRT_CD: '035420',
      ISU_NM: 'NAVER',
      ISU_ABBRV: 'NAVER',
      MKT_TP_NM: 'KOSPI',
    },
  ],
};

describe('parseKrxInstruments', () => {
  it('maps ticker, isin, name, and market', () => {
    const entries = parseKrxInstruments(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      ticker: '005930',
      isin: 'KR7005930003',
      name: '삼성전자',
      market: 'KOSPI',
    });
  });

  it('drops rows missing a 6-digit ticker or an ISIN', () => {
    const entries = parseKrxInstruments({
      OutBlock_1: [
        { ISU_CD: 'KR7005930003', ISU_SRT_CD: '00593', ISU_ABBRV: 'bad ticker' },
        { ISU_SRT_CD: '005930', ISU_ABBRV: 'no isin' },
        { ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_ABBRV: 'ok' },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('ok');
  });

  it('returns [] when OutBlock_1 is absent or empty', () => {
    expect(parseKrxInstruments({})).toEqual([]);
    expect(parseKrxInstruments({ OutBlock_1: [] })).toEqual([]);
  });
});
