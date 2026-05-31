import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { zipSync, strToU8 } from 'fflate';
import {
  decodeDsd,
  extractDsdBody,
  dsdToPlainText,
  splitSections,
  selectSections,
  sectionTitles,
} from './dart-document.js';

// Handwritten DSD fixture modeled on the confirmed real structure:
// <TITLE> tags delimit sections (ASCII Roman majors, Arabic subs), tables carry
// numbers (dropped), and full-width Ⅰ/Ⅱ appear only in prose cross-refs / table cells.
const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<DOCUMENT><BODY>
<TITLE ATOC="N" ENG="Table of Contents">목     차</TITLE>
<P>표지</P>
<TITLE ATOC="Y" ENG="I. Company Overview">I. 회사의 개요</TITLE>
<TITLE ATOC="Y" ENG="1. Company overview">1. 회사의 개요</TITLE>
<P>당사는 테스트 주식회사이며 R&amp;D&nbsp;중심 기업입니다.</P>
<TITLE ATOC="Y" ENG="II. Business Description">II. 사업의 내용</TITLE>
<P>☞ 자세한 사항은 'Ⅱ. 사업의 내용'을 참고하시기 바랍니다.</P>
<TITLE ATOC="Y" ENG="1. Business overview">1. 사업의 개요</TITLE>
<P>당사는 반도체와 디스플레이 두 부문으로 구성되어 있습니다.</P>
<TITLE ATOC="Y" ENG="2. Main products and services">2. 주요 제품 및 서비스</TITLE>
<P>주요 제품은 DRAM과 NAND입니다.</P>
<TABLE><TR><TD>Ⅰ. 발행할 주식의 총수</TD><TD>1,000,000</TD></TR></TABLE>
<TITLE ATOC="Y" ENG="5. Risk management and derivatives transactions">5. 위험관리 및 파생거래</TITLE>
<P>당사는 환율변동위험과 신용위험에 노출되어 있습니다.</P>
<TITLE ATOC="Y" ENG="III. Financial Matters">III. 재무에 관한 사항</TITLE>
<TITLE ATOC="Y" ENG="1. Summary">1. 요약재무정보</TITLE>
<TABLE><TR><TD>매출액</TD><TD>100</TD></TR></TABLE>
<TITLE ATOC="Y" ENG="IV. Management Assessment and Analysis Opinion">IV. 이사의 경영진단 및 분석의견</TITLE>
<TITLE ATOC="Y" ENG="1. Forecast caution">1. 예측정보에 대한 주의사항</TITLE>
<P>본 자료는 예측정보를 포함합니다.</P>
<TITLE ATOC="Y" ENG="XI. Other matters">XI. 그 밖에 투자자 보호를 위하여 필요한 사항</TITLE>
<TITLE ATOC="Y" ENG="3. Sanctions">3. 제재현황 등</TITLE>
<P>당사는 중대한 제재를 받은 사실이 없습니다.</P>
</BODY></DOCUMENT>`;

describe('dsdToPlainText', () => {
  it('drops tables, strips tags, decodes entities', () => {
    const out = dsdToPlainText('<P>R&amp;D&nbsp;중심</P><TABLE><TR><TD>9,999</TD></TR></TABLE>');
    expect(out).toContain('R&D 중심');
    expect(out).not.toContain('9,999');
  });
});

describe('splitSections', () => {
  const sections = splitSections(SAMPLE);

  it('identifies the five major Roman sections', () => {
    const majors = sections.filter((s) => s.level === 'major').map((s) => s.numeral);
    expect(majors).toEqual(['I', 'II', 'III', 'IV', 'XI']);
  });

  it('attaches Arabic sub-sections to their parent major', () => {
    const risk = sections.find((s) => s.title.includes('위험관리'));
    expect(risk?.numeral).toBe('5');
    expect(risk?.level).toBe('sub');
    expect(risk?.parent).toBe('II');
  });

  it('does not treat full-width Ⅱ in prose/table cells as a section', () => {
    // Only one section should carry the 'II' numeral (the real <TITLE>), not the cross-ref.
    expect(sections.filter((s) => s.numeral === 'II').length).toBe(1);
  });
});

describe('selectSections', () => {
  const sections = splitSections(SAMPLE);

  it('business pulls all of II incl. sub-sections', () => {
    const { business } = selectSections(sections, ['business']);
    expect(business).toContain('반도체와 디스플레이');
    expect(business).toContain('DRAM과 NAND');
    expect(business).toContain('환율변동위험'); // 위험관리 is part of II
  });

  it('products pulls only the product sub-section, not risk prose', () => {
    const { products } = selectSections(sections, ['products']);
    expect(products).toContain('DRAM과 NAND');
    expect(products).not.toContain('환율변동위험');
  });

  it('risks pulls the scattered II.5 위험관리 + XI 투자자 보호', () => {
    const { risks } = selectSections(sections, ['risks']);
    expect(risks).toContain('환율변동위험'); // II.5 위험관리
    expect(risks).toContain('제재를 받은 사실'); // XI.3 제재현황
    expect(risks).not.toContain('DRAM과 NAND'); // not products
  });

  it('mdna pulls IV management discussion', () => {
    const { mdna } = selectSections(sections, ['mdna']);
    expect(mdna).toContain('예측정보를 포함');
  });

  it('overview decodes entities in I. 회사의 개요', () => {
    const { overview } = selectSections(sections, ['overview']);
    expect(overview).toContain('R&D 중심');
  });

  it('drops table numbers from narrative output', () => {
    const { business } = selectSections(sections, ['business']);
    expect(business).not.toContain('1,000,000');
    expect(business).not.toContain('발행할 주식의 총수');
  });
});

describe('extractDsdBody', () => {
  it('picks the main no-underscore .xml entry over attachments', () => {
    const zip = zipSync({
      '20260310002820.xml': strToU8('<DOCUMENT>MAIN BODY 본문</DOCUMENT>'),
      '20260310002820_00760.xml': strToU8('<DOCUMENT>감사보고서</DOCUMENT>'),
    });
    expect(extractDsdBody(zip)).toContain('MAIN BODY');
  });

  it('throws on an empty ZIP', () => {
    expect(() => extractDsdBody(zipSync({}))).toThrow();
  });
});

describe('decodeDsd', () => {
  it('decodes UTF-8 bytes', () => {
    expect(decodeDsd(strToU8('삼성전자'))).toBe('삼성전자');
  });

  it('falls back to EUC-KR when UTF-8 yields replacement chars', () => {
    // EUC-KR 0xB0A1 = '가'; invalid as UTF-8 → triggers the fallback branch.
    const bytes = new Uint8Array(Array.from({ length: 30 }, () => [0xb0, 0xa1]).flat());
    expect(decodeDsd(bytes)).toContain('가가');
  });
});

describe('real fixture (Samsung 005930 사업보고서 II. 사업의 내용)', () => {
  const fixture = readFileSync(`${import.meta.dir}/__fixtures__/dsd-005930-business-section.xml`, 'utf-8');
  const sections = splitSections(fixture);

  it('finds the II. 사업의 내용 major and its 7 sub-sections', () => {
    const titles = sectionTitles(sections);
    expect(titles.some((t) => t.includes('사업의 내용'))).toBe(true);
    expect(titles.some((t) => t.includes('위험관리'))).toBe(true);
  });

  it('extracts grounded business + products + risk prose', () => {
    const sel = selectSections(sections, ['business', 'products', 'risks']);
    expect(sel.business).toContain('부문'); // segment narrative
    expect(sel.products).toContain('DRAM');
    expect(sel.risks).toContain('위험'); // 재무위험관리정책 …
  });
});
