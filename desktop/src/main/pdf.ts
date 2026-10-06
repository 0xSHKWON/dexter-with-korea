import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { ChatPdfDoc, ChatPdfResult } from '../shared/types';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
}

/** `삼성전자 리스크 정리 2026-10-03.pdf` — strips characters macOS/Windows reject. */
function defaultFileName(doc: ChatPdfDoc): string {
  const base = doc.title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || 'Dexter 리포트';
  const d = new Date(doc.answeredAt ?? Date.now());
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${base} ${ymd}.pdf`;
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: #1f2328;
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
    'Malgun Gothic', system-ui, sans-serif;
  font-size: 10.5pt;
  line-height: 1.7;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.brand {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 8.5pt; letter-spacing: 0.12em; color: #57606a; font-weight: 600;
  padding-bottom: 10px; border-bottom: 2px solid #1f2328;
}
.brand .kind { letter-spacing: 0; font-weight: 500; }
h1.title { font-size: 19pt; line-height: 1.35; margin: 18px 0 10px; letter-spacing: -0.02em; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 22px; font-size: 9pt; color: #57606a; margin-bottom: 16px; }
.meta b { color: #1f2328; font-weight: 600; margin-right: 6px; }
.question {
  background: #f3f5f8; border-left: 3px solid #0969da; border-radius: 4px;
  padding: 10px 14px; margin: 0 0 22px; font-size: 10pt; white-space: pre-wrap;
}
.question .label { display: block; font-size: 8pt; font-weight: 700; color: #0969da; letter-spacing: 0.08em; margin-bottom: 2px; }
.answer > :first-child { margin-top: 0; }
.answer h1, .answer h2, .answer h3, .answer h4 { line-height: 1.4; margin: 1.4em 0 0.5em; break-after: avoid; }
.answer h1 { font-size: 15pt; }
.answer h2 { font-size: 13pt; padding-bottom: 4px; border-bottom: 1px solid #d0d7de; }
.answer h3 { font-size: 11.5pt; }
.answer h4 { font-size: 10.5pt; }
.answer p { margin: 0.55em 0; }
.answer ul, .answer ol { padding-left: 1.4em; margin: 0.5em 0; }
.answer li { margin: 0.2em 0; }
.answer strong { font-weight: 700; color: #0d1117; }
.answer a { color: #0969da; text-decoration: none; }
.answer blockquote { margin: 0.8em 0; padding: 4px 12px; color: #57606a; border-left: 3px solid #d0d7de; }
.answer hr { border: none; border-top: 1px solid #d0d7de; margin: 1.4em 0; }
.answer code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.88em; background: #f3f5f8; padding: 1px 5px; border-radius: 4px; }
.answer pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; break-inside: avoid; }
.answer pre code { background: none; padding: 0; }
.answer table { width: 100%; border-collapse: collapse; margin: 0.9em 0; font-size: 9pt; break-inside: auto; }
.answer thead { display: table-header-group; }
.answer tr { break-inside: avoid; }
.answer th { background: #f0f3f6; font-weight: 600; text-align: left; }
.answer th, .answer td { border: 1px solid #d0d7de; padding: 5px 8px; vertical-align: top; }
.answer tbody tr:nth-child(even) td { background: #fafbfc; }
.answer math[display="block"] { display: block; margin: 0.9em 0; text-align: center; font-size: 1.08em; overflow-wrap: normal; }
.sources { margin-top: 28px; padding-top: 10px; border-top: 1px solid #d0d7de; font-size: 8.5pt; color: #57606a; break-inside: avoid; }
.sources h2 { font-size: 9pt; margin: 0 0 4px; color: #1f2328; }
.sources ul { margin: 0; padding-left: 1.2em; columns: 2; column-gap: 24px; }
.disclaimer { margin-top: 16px; font-size: 8pt; color: #8c959f; }
`;

function buildHtml(doc: ChatPdfDoc): string {
  const meta: string[] = [];
  if (doc.askedAt) meta.push(`<span><b>질문</b>${esc(fmtTime(doc.askedAt))}</span>`);
  if (doc.answeredAt) meta.push(`<span><b>답변</b>${esc(fmtTime(doc.answeredAt))}</span>`);
  if (doc.askedAt && doc.answeredAt && doc.answeredAt > doc.askedAt) {
    meta.push(`<span><b>소요</b>${esc(fmtElapsed(doc.answeredAt - doc.askedAt))}</span>`);
  }
  const sources = doc.sources.length
    ? `<section class="sources"><h2>조회한 데이터</h2><ul>${doc.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>`
    : '';
  // The title is the question cut to 40 chars — repeat the question only when it was cut.
  const question =
    doc.question.trim() !== doc.title.trim()
      ? `<div class="question"><span class="label">QUESTION</span>${esc(doc.question)}</div>`
      : '';
  // The answer is model output: no script, no remote fetches (images/fonts) from the print window.
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${esc(doc.title)}</title><style>${CSS}</style></head>
<body>
<div class="brand"><span>DEXTER</span><span class="kind">AI 리서치 리포트</span></div>
<h1 class="title">${esc(doc.title)}</h1>
<div class="meta">${meta.join('')}</div>
${question}
<article class="answer">${doc.answerHtml}</article>
${sources}
<p class="disclaimer">이 문서는 AI가 공개 데이터를 바탕으로 작성한 참고 자료이며 투자 권유가 아닙니다. 수치는 원문 공시로 확인하세요.</p>
</body></html>`;
}

const FOOTER = `<div style="width:100%;font-size:7.5pt;color:#8c959f;padding:0 16mm;display:flex;justify-content:space-between;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<span>Dexter</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

/** Ask where to save, render the answer to A4 PDF in a hidden window, then open it. */
export async function exportChatPdf(parent: BrowserWindow | null, doc: ChatPdfDoc): Promise<ChatPdfResult> {
  const opts = { defaultPath: defaultFileName(doc), filters: [{ name: 'PDF', extensions: ['pdf'] }] };
  const { canceled, filePath } = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
  if (canceled || !filePath) return { saved: false };

  // A temp file rather than a data: URL — long answers blow past data-URL limits.
  const dir = await mkdtemp(join(tmpdir(), 'dexter-pdf-'));
  const htmlPath = join(dir, 'report.html');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await writeFile(htmlPath, buildHtml(doc), 'utf8');
    await win.loadFile(htmlPath);
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER,
    });
    await writeFile(filePath, pdf);
  } finally {
    win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
  void shell.openPath(filePath);
  return { saved: true, path: filePath };
}
