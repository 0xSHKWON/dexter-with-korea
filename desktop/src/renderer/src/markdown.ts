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
