import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { parseCorpCodeXml, extractCorpCodeXmlFromZip } from './dart-corp-codes.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <stock_code>005930</stock_code>
    <modify_date>20231201</modify_date>
  </list>
  <list>
    <corp_code>00164779</corp_code>
    <corp_name>SK하이닉스</corp_name>
    <stock_code>000660</stock_code>
    <modify_date>20231115</modify_date>
  </list>
  <list>
    <corp_code>00999999</corp_code>
    <corp_name>비상장회사</corp_name>
    <stock_code> </stock_code>
    <modify_date>20231101</modify_date>
  </list>
</result>`;

describe('parseCorpCodeXml', () => {
  test('parses Samsung and SK Hynix from sample XML', () => {
    const entries = parseCorpCodeXml(SAMPLE_XML);
    expect(entries).toHaveLength(3);

    const samsung = entries.find((e) => e.stock_code === '005930');
    expect(samsung).toEqual({
      corp_code: '00126380',
      corp_name: '삼성전자',
      stock_code: '005930',
      modify_date: '20231201',
    });

    const skHynix = entries.find((e) => e.stock_code === '000660');
    expect(skHynix?.corp_name).toBe('SK하이닉스');
  });

  test('normalizes empty stock_code to null', () => {
    const entries = parseCorpCodeXml(SAMPLE_XML);
    const unlisted = entries.find((e) => e.corp_name === '비상장회사');
    expect(unlisted?.stock_code).toBeNull();
  });

  test('handles single-entry XML (XMLParser drops array wrapper)', () => {
    const single = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list>
    <corp_code>00126380</corp_code>
    <corp_name>삼성전자</corp_name>
    <stock_code>005930</stock_code>
    <modify_date>20231201</modify_date>
  </list>
</result>`;
    const entries = parseCorpCodeXml(single);
    expect(entries).toHaveLength(1);
    expect(entries[0].stock_code).toBe('005930');
  });

  test('returns empty array when no list element', () => {
    expect(parseCorpCodeXml('<?xml version="1.0"?><result></result>')).toEqual([]);
  });
});

describe('extractCorpCodeXmlFromZip', () => {
  test('unzips and decodes CORPCODE.xml', () => {
    const bytes = zipSync({ 'CORPCODE.xml': strToU8(SAMPLE_XML) });
    const xml = extractCorpCodeXmlFromZip(bytes);
    expect(xml).toContain('삼성전자');
    expect(xml).toContain('005930');
  });

  test('falls back to first file if named entry absent', () => {
    const bytes = zipSync({ 'something-else.xml': strToU8('<result></result>') });
    const xml = extractCorpCodeXmlFromZip(bytes);
    expect(xml).toBe('<result></result>');
  });
});
