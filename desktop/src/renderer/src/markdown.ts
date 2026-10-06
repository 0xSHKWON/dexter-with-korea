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

/**
 * remark-math understands dollar delimiters, while LLMs commonly emit LaTeX's
 * `\[...\]` / `\(...\)` forms. CommonMark otherwise consumes those slashes as
 * escapes and leaves a misleading `[ ... ]` on screen. Also accept a bare
 * bracketed equation as a fallback for already-normalized model output.
 */
export function normalizeMathDelimiters(markdown: string): string {
  const delimited = markdown
    // Replacement strings treat `$$` as an escaped single dollar; callbacks
    // preserve the two delimiters verbatim.
    .replace(/\\\[\s*/g, () => '\n$$\n')
    .replace(/\s*\\\]/g, () => '\n$$\n')
    .replace(/\\\(/g, () => '$')
    .replace(/\\\)/g, () => '$')
    .replace(BRACKETED_EQUATION, (_match, expression: string) => `$$\n${expression.trim()}\n$$`);

  // In TeX, an unescaped % starts a comment. Financial models nearly always
  // mean a percentage, so preserve it as a visible percent sign inside math.
  return delimited.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_match, block?: string, inline?: string) => {
    const expression = (block ?? inline ?? '').replace(/(^|[^\\])%/g, '$1\\%');
    return block !== undefined ? `$$${expression}$$` : `$${expression}$`;
  });
}

export function normalizeMarkdown(markdown: string): string {
  return normalizeKoreanBold(normalizeMathDelimiters(markdown));
}
