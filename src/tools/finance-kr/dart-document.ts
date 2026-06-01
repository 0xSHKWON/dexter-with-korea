/**
 * Parse the narrative body of a DART periodic report (사업/반기/분기보고서).
 *
 * The `/document.xml` endpoint returns a ZIP of DART "DSD" documents (quasi-XML).
 * Ground truth (confirmed against 005930 사업보고서):
 *  - The ZIP holds the main report (`<rcept_no>.xml`) plus `_NNNNN.xml` attachments
 *    (감사보고서 etc.). Narrative lives only in the main, no-underscore entry.
 *  - Encoding is UTF-8 (declared); legacy filings may be EUC-KR → fallback.
 *  - Sections are delimited by `<TITLE ATOC="Y" ENG="...">한글 제목</TITLE>`:
 *    majors use ASCII Roman (`II. 사업의 내용`), sub-sections use Arabic (`5. 위험관리…`).
 *    Full-width `Ⅱ/Ⅲ` only occur in prose cross-refs and table cells, so anchoring
 *    on `<TITLE>` tags (not free-text regex) avoids those false positives.
 *  - Risk is scattered: `II. 5. 위험관리 및 파생거래` + `XI. 그 밖에 투자자 보호…`.
 *  - Tables dominate the byte count and carry numbers (→ get_financials_kr); we drop
 *    them and keep prose.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { dartApi } from './api.js';

/** Narrative section categories the planner can request. */
export type SectionCategory = 'overview' | 'business' | 'products' | 'risks' | 'mdna';

export const SECTION_CATEGORIES: readonly SectionCategory[] = [
  'overview',
  'business',
  'products',
  'risks',
  'mdna',
];

export interface DsdSection {
  /** Normalized numeral: 'I'..'XV' (major) or '5', '2-1' (sub); '' when headerless. */
  numeral: string;
  level: 'major' | 'sub';
  /** Korean title without the leading numeral, e.g. '사업의 내용'. */
  title: string;
  /** Parent major numeral for sub-sections (e.g. 'II'); '' for majors. */
  parent: string;
  /** Raw DSD fragment between this title and the next; clean via `sectionText`. */
  html: string;
}

const FULLWIDTH_ROMAN: Record<string, string> = {
  'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V',
  'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X',
  'Ⅺ': 'XI', 'Ⅻ': 'XII',
};

const MAJOR_NUMERALS = new Set([
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
]);

// ---------------------------------------------------------------------------
// ZIP → main document string
// ---------------------------------------------------------------------------

/** Decode DSD bytes; UTF-8 first, EUC-KR fallback for legacy filings. */
export function decodeDsd(bytes: Uint8Array): string {
  const utf8 = strFromU8(bytes);
  const repl = utf8.match(/�/g)?.length ?? 0;
  if (repl > 20) {
    try {
      const euckr = new TextDecoder('euc-kr').decode(bytes);
      const hangul = (s: string) => s.match(/[가-힣]/g)?.length ?? 0;
      if (hangul(euckr) > hangul(utf8)) return euckr;
    } catch {
      /* keep utf8 */
    }
  }
  return utf8;
}

/**
 * Pick and decode the main narrative document from the document.xml ZIP.
 * Prefers the `.xml` entry with no `_NNNNN` attachment suffix (the report body),
 * choosing the largest such entry; falls back to the largest entry overall.
 */
export function extractDsdBody(zipBytes: Uint8Array): string {
  const files = unzipSync(zipBytes);
  const names = Object.keys(files);
  if (names.length === 0) {
    throw new Error('[DART document] ZIP contained no files');
  }
  const xml = names.filter((n) => /\.xml$/i.test(n));
  const candidates = xml.length > 0 ? xml : names;
  const noSuffix = candidates.filter((n) => /^[^_]+\.xml$/i.test(n));
  const pool = noSuffix.length > 0 ? noSuffix : candidates;
  const main = pool.slice().sort((a, b) => files[b].length - files[a].length)[0];
  return decodeDsd(files[main]);
}

// ---------------------------------------------------------------------------
// DSD markup → plain text
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    });
}

/** Strip nested tags inside a `<TITLE>…</TITLE>` to its visible text. */
function titleText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Convert a DSD fragment to readable plaintext: drop tables/images (numbers belong
 * to get_financials_kr), turn block tags into newlines, strip the rest, decode
 * entities, and collapse whitespace.
 */
export function dsdToPlainText(fragment: string): string {
  const stripped = fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<TABLE\b[\s\S]*?<\/TABLE>/gi, '\n')
    .replace(/<IMG\b[\s\S]*?<\/IMG>/gi, ' ')
    .replace(/<IMAGE\b[^>]*>/gi, ' ')
    .replace(/<\/?(P|BR|TR|DIV|SPAN|TITLE|SECTION-\d+|PGBRK|LI|UL)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Clean text of a parsed section (lazy — only call on sections you keep). */
export function sectionText(section: DsdSection): string {
  return dsdToPlainText(section.html);
}

// ---------------------------------------------------------------------------
// Section splitting + selection
// ---------------------------------------------------------------------------

const TITLE_RE = /<TITLE\b[^>]*>([\s\S]*?)<\/TITLE>/gi;

function classifyTitle(title: string): { numeral: string; level: 'major' | 'sub'; name: string } {
  // Major: ASCII Roman numeral + '.' (e.g. "II. 사업의 내용").
  const major = title.match(/^([IVXLC]+)\s*[.．]\s*(.+)$/);
  if (major && MAJOR_NUMERALS.has(major[1])) {
    return { numeral: major[1], level: 'major', name: major[2].trim() };
  }
  // Full-width Roman fallback (rare in titles).
  const fw = title.match(/^([Ⅰ-Ⅻ])\s*[.．]\s*(.+)$/);
  if (fw) {
    return { numeral: FULLWIDTH_ROMAN[fw[1]] ?? fw[1], level: 'major', name: fw[2].trim() };
  }
  // Sub: Arabic numeral, optionally "n-m" (e.g. "5. 위험관리…", "2-1. 연결 재무상태표").
  const sub = title.match(/^(\d+(?:-\d+)?)\s*[.．]\s*(.+)$/);
  if (sub) {
    return { numeral: sub[1], level: 'sub', name: sub[2].trim() };
  }
  // Headerless (목차, 【대표이사 등의 확인】) — keep as a no-numeral leaf.
  return { numeral: '', level: 'sub', name: title };
}

/** Split a DSD document into an ordered, hierarchy-aware list of sections. */
export function splitSections(body: string): DsdSection[] {
  const anchors: { titleStart: number; bodyStart: number; title: string }[] = [];
  for (const m of body.matchAll(TITLE_RE)) {
    anchors.push({
      titleStart: m.index ?? 0,
      bodyStart: (m.index ?? 0) + m[0].length,
      title: titleText(m[1]),
    });
  }

  const sections: DsdSection[] = [];
  let currentMajor = '';
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const bodyEnd = i + 1 < anchors.length ? anchors[i + 1].titleStart : body.length;
    const { numeral, level, name } = classifyTitle(a.title);
    if (level === 'major') currentMajor = numeral;
    sections.push({
      numeral,
      level,
      title: name,
      parent: level === 'sub' ? currentMajor : '',
      html: body.slice(a.bodyStart, bodyEnd),
    });
  }
  return sections;
}

function sectionMatches(s: DsdSection, cat: SectionCategory): boolean {
  switch (cat) {
    case 'overview':
      // I. 회사의 개요 + its sub-sections.
      return (s.numeral === 'I' && s.level === 'major') || s.parent === 'I';
    case 'business':
      // II. 사업의 내용 + all its sub-sections (사업개요·제품·매출·위험관리·R&D…).
      return (s.numeral === 'II' && s.level === 'major') || s.parent === 'II';
    case 'products':
      // Sub-sections under II about products / sales / materials.
      return s.parent === 'II' && /제품|서비스|매출|수주|원재료|생산설비/.test(s.title);
    case 'risks':
      // Scattered: II.5 위험관리 및 파생거래 + all of XI 투자자 보호 + any 위험요소.
      return (
        (s.parent === 'II' && /위험\s*관리|파생거래/.test(s.title)) ||
        (s.numeral === 'XI' && s.level === 'major') ||
        s.parent === 'XI' ||
        /위험\s*요소/.test(s.title)
      );
    case 'mdna':
      // IV. 이사의 경영진단 및 분석의견 + sub-sections.
      return (
        (s.numeral === 'IV' && s.level === 'major') ||
        s.parent === 'IV' ||
        /경영\s*진단|분석의견/.test(s.title)
      );
    default:
      return false;
  }
}

/** Select and clean the requested categories from a parsed section list. */
export function selectSections(
  sections: DsdSection[],
  categories: SectionCategory[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cat of categories) {
    const blocks: string[] = [];
    for (const s of sections) {
      if (!sectionMatches(s, cat)) continue;
      const text = sectionText(s);
      if (text.trim().length === 0) continue;
      const label = s.numeral ? `${s.numeral}. ${s.title}` : s.title;
      blocks.push(`[${label}]\n${text}`);
    }
    // Triple-newline between blocks (dsdToPlainText caps internal runs at \n\n) so the
    // summary builder can split blocks apart again for cross-category dedup.
    if (blocks.length > 0) out[cat] = blocks.join('\n\n\n');
  }
  return out;
}

/** A flat list of section headings, for surfacing what was present on a miss. */
export function sectionTitles(sections: DsdSection[]): string[] {
  return sections
    .filter((s) => s.numeral !== '')
    .map((s) => `${s.numeral}. ${s.title}`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ExtractedSections {
  sections: Record<string, string>;
  url: string;
  allTitles: string[];
}

/** Fetch document.xml, unzip, parse, and select the requested narrative categories. */
export async function fetchAndExtractSections(
  rceptNo: string,
  categories: SectionCategory[],
): Promise<ExtractedSections> {
  const { bytes, url } = await dartApi.getBinary('/document.xml', { rcept_no: rceptNo });
  const body = extractDsdBody(bytes);
  const all = splitSections(body);
  return {
    sections: selectSections(all, categories),
    url,
    allTitles: sectionTitles(all),
  };
}
