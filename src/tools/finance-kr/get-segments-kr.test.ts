import { describe, it, expect } from 'bun:test';
import { isNumericCell, selectSegmentTables } from './get-segments-kr.js';
import { parseDsdTables } from './dart-document.js';

describe('isNumericCell', () => {
  it('treats formatted Korean financial figures as numeric', () => {
    for (const s of ['526,547', '39.3%', '(1,234)', '△123', '1,879,673']) {
      expect(isNumericCell(s)).toBe(true);
    }
  });
  it('rejects label cells', () => {
    for (const s of ['DX 부문', '제58기 1분기', '매출액', '']) {
      expect(isNumericCell(s)).toBe(false);
    }
  });
});

describe('selectSegmentTables', () => {
  // Mirrors the real 005930 분기보고서 shapes: the 부문별 P&L summary, a product-type
  // table (no 영업이익), a sprawling R&D narrative, and an unrelated table.
  const pnl = [
    ['부문', '구분', '제58기 1분기', '제57기', '제56기'],
    ['DX 부문', '매출액', '526,547', '1,879,673', '1,748,877'],
    ['', '영업이익', '29,677', '128,527', '124,399'],
    ['DS 부문', '매출액', '817,156', '1,301,282', '1,110,660'],
    ['', '영업이익', '69,000', '150,000', '230,000'],
  ];
  const productType = [
    ['부문', '매출유형', '품목', '제58기 1분기'],
    ['DX 부문', '제·상품', 'TV, 모니터 등', '526,547'],
    ['DS 부문', '제·상품', 'DRAM, NAND 등', '817,156'],
    ['SDC', '제·상품', 'OLED 패널 등', '66,935'],
  ];
  const rndNarrative = Array.from({ length: 90 }, (_, i) => ['DX 부문', `연구과제 ${i}`, '기대효과 텍스트, 매출 기여 …']);
  const unrelated = [
    ['구분', '금액'],
    ['현금', '1,000'],
    ['예금', '2,000'],
  ];

  it('keeps segment financial tables and ranks the P&L (영업이익) summary first', () => {
    const out = selectSegmentTables([rndNarrative, productType, pnl, unrelated], 3);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].hasOperatingProfit).toBe(true);
    expect(out[0].rows[1]).toContain('매출액');
    // unrelated table (no 부문) is excluded
    expect(out.every((t) => t.rows.flat().join(' ').includes('부문'))).toBe(true);
  });

  it('respects the limit', () => {
    expect(selectSegmentTables([rndNarrative, productType, pnl], 1).length).toBe(1);
    expect(selectSegmentTables([rndNarrative, productType, pnl], 1)[0].hasOperatingProfit).toBe(true);
  });

  it('parses DSD <TABLE> markup into rows and feeds selection end-to-end', () => {
    const markup =
      '<TABLE><TBODY>' +
      '<TR><TD><P>부문</P></TD><TD><P>구분</P></TD><TD><P>제58기</P></TD><TD><P>제57기</P></TD><TD><P>제56기</P></TD></TR>' +
      '<TR><TD><P>DX 부문</P></TD><TD><P>매출액</P></TD><TD><P>526,547</P></TD><TD><P>1,879,673</P></TD><TD><P>1,748,877</P></TD></TR>' +
      '<TR><TD><P>　</P></TD><TD><P>영업이익</P></TD><TD><P>29,677</P></TD><TD><P>128,527</P></TD><TD><P>124,399</P></TD></TR>' +
      '</TBODY></TABLE>';
    const tables = parseDsdTables(markup);
    expect(tables.length).toBe(1);
    expect(tables[0][1]).toEqual(['DX 부문', '매출액', '526,547', '1,879,673', '1,748,877']);
    const out = selectSegmentTables(tables, 3);
    expect(out.length).toBe(1);
    expect(out[0].hasOperatingProfit).toBe(true);
  });
});
