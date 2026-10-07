/**
 * CommonMark refuses to close emphasis when the span ends in punctuation and a
 * letter follows immediately, so `**42.8%**로` renders with the asterisks visible.
 * Korean attaches a particle straight onto a number, and the desktop prompt asks
 * the model to bold the numbers that matter — the two collide constantly.
 *
 * Asking the model to write it differently did not hold (observed live: it still
 * produced `**...42.8%**로,`), so normalize it here instead: pull the trailing
 * particle inside the emphasis, which is the spelling that does parse. Spans that
 * already render — a letter before the closing `**`, or a space/punctuation after
 * it — are left exactly as they are.
 */
const UNCLOSABLE_BOLD = /\*\*([^*\n]*[%)\]},.·])\*\*([가-힣]{1,10})/g;

export function normalizeKoreanBold(markdown: string): string {
  return markdown.replace(UNCLOSABLE_BOLD, '**$1$2**');
}

const BRACKETED_EQUATION = /^\[\s*([^\]\n]*=[^\]\n]*)\s*\]$/gm;

// Delimiters may span lines but never a blank line (that would cross a paragraph).
const DISPLAY_DELIMITED = /\\\[((?:(?!\n[ \t]*\n)[\s\S])*?)\\\]/g;
const INLINE_DELIMITED = /\\\(((?:(?!\n[ \t]*\n)[\s\S])*?)\\\)/g;
// `\[1\]` is also how models escape a literal footnote bracket in prose; only
// content that looks like math is converted.
const MATH_SIGNAL = /\\[a-zA-Z]+|[=^_+*/<>×÷≤≥]|\d\s*-\s*\d/;
// A display block would break these lines apart (list item, table row, quote,
// heading), so math found on them stays inline.
const INLINE_ONLY_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\|)|\|.*\|/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[\s\S]*?[^`]\1(?!`)/g;

// In TeX, an unescaped % starts a comment. Financial models nearly always mean
// a percentage, so keep it as a visible percent sign inside math.
function escapePercent(expression: string): string {
  return expression.replace(/(^|[^\\])%/g, '$1\\%');
}

function lineAround(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  return text.slice(start, end === -1 ? undefined : end);
}

// Callbacks rather than replacement strings throughout: in a replacement string
// `$$` means one literal dollar.
function convertDelimiters(text: string): string {
  return text
    .replace(DISPLAY_DELIMITED, (match: string, expression: string, offset: number, whole: string) => {
      if (!MATH_SIGNAL.test(expression)) return match;
      if (INLINE_ONLY_LINE.test(lineAround(whole, offset))) {
        return `$$${escapePercent(expression.trim().replace(/\s*\n\s*/g, ' '))}$$`;
      }
      return `\n$$\n${escapePercent(expression.trim())}\n$$\n`;
    })
    .replace(INLINE_DELIMITED, (_match: string, expression: string) =>
      `$$${escapePercent(expression.trim().replace(/\s*\n\s*/g, ' '))}$$`,
    )
    .replace(BRACKETED_EQUATION, (_match: string, expression: string) => `$$\n${escapePercent(expression.trim())}\n$$`)
    .replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_match: string, block?: string, inline?: string) =>
      block !== undefined ? `$$${escapePercent(block)}$$` : `$${escapePercent(inline ?? '')}$`,
    );
}

function withInlineCodeProtected(text: string, transform: (text: string) => string): string {
  const spans: string[] = [];
  const masked = text.replace(INLINE_CODE, (span: string) => `\u0000${spans.push(span) - 1}\u0000`);
  return transform(masked).replace(/\u0000(\d+)\u0000/g, (_m: string, i: string) => spans[Number(i)]);
}

/**
 * remark-math understands dollar delimiters, while LLMs commonly emit LaTeX's
 * `\[...\]` / `\(...\)` forms. CommonMark otherwise consumes those slashes as
 * escapes and leaves a misleading `[ ... ]` on screen. Also accept a bare
 * bracketed equation as a fallback for already-normalized model output.
 *
 * This has to run on the raw string — once parsed, `\[` is indistinguishable
 * from `[` — so code is skipped by hand: fenced blocks line by line, inline
 * code spans by masking.
 */
export function normalizeMathDelimiters(markdown: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flushProse = (): void => {
    if (prose.length === 0) return;
    out.push(withInlineCodeProtected(prose.join('\n'), convertDelimiters));
    prose = [];
  };

  for (const line of markdown.split('\n')) {
    if (fence) {
      out.push(line);
      const close = line.match(FENCE_OPEN);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) {
        fence = null;
      }
      continue;
    }
    const open = line.match(FENCE_OPEN);
    if (open) {
      flushProse();
      fence = open[1];
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join('\n');
}

export function normalizeMarkdown(markdown: string): string {
  return normalizeKoreanBold(normalizeMathDelimiters(markdown));
}
