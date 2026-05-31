// Console formatting for the eval report. Mirrors the separator style of the
// single-query seed (scripts/kr-eval.ts) — plain console output, not app logging.

import type { AggregateReport, QuestionResult } from './scorer.js';

const BAR = '='.repeat(80);

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function questionLine(r: QuestionResult): string {
  if (r.skipped) return `  SKIP  ${r.id.padEnd(26)} — ${r.skipped}`;
  const tag = r.pass ? 'PASS' : 'FAIL';
  const dims = r.dimensions.map((d) => `${d.id}=${d.score.toFixed(2)}${d.pass ? '' : '✗'}`).join(' ');
  const missing = r.missingRequired.length ? `  missingReq=[${r.missingRequired.join(',')}]` : '';
  const misses = r.replayMisses.length ? `  replayMiss=[${[...new Set(r.replayMisses)].join(',')}]` : '';
  return `  ${tag}  ${r.id.padEnd(26)} tools=${fmtPct(r.toolsScore)} ${dims}${missing}${misses}`;
}

export function printReport(report: AggregateReport): void {
  console.log('\n' + BAR);
  console.log(
    `KR EVAL — mode=${report.meta.mode}  agent=${report.meta.agentModel}  judge=${report.meta.judgeModel}`,
  );
  console.log(BAR);

  for (const r of report.results) {
    console.log(questionLine(r));
    if (!r.skipped) {
      for (const d of r.dimensions) {
        if (!d.pass) console.log(`        ↳ ${d.id}: ${d.comment}`);
      }
    }
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`Passed ${report.passed}/${report.ran}  (skipped ${report.skipped})`);
  console.log(`Tool-fire rate: ${fmtPct(report.toolFireRate)}`);
  const dimKeys = Object.keys(report.byDimension);
  if (dimKeys.length > 0) {
    console.log('By dimension (mean / pass-rate):');
    for (const key of dimKeys) {
      const d = report.byDimension[key as keyof typeof report.byDimension];
      if (d) console.log(`  ${key.padEnd(16)} mean=${d.mean.toFixed(2)}  pass=${fmtPct(d.passRate)}`);
    }
  }
  console.log(BAR);
}
