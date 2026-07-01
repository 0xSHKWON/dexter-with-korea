import { useState } from 'react';
import type { Question, QuestionAnswer, UserAnswers } from '../../../shared/sidecar';

/** Sentinel selection marking the free-text "직접 입력" choice. */
const OTHER = '__other__';

interface Props {
  questions: Question[];
  onSubmit: (answers: UserAnswers) => void;
  onDismiss: () => void;
}

/**
 * Inline panel for an `ask_user_question` prompt — the desktop counterpart of the
 * CLI's QuestionPromptComponent. Renders 1-4 questions with their options plus a
 * free-text "직접 입력" (the auto "Other" choice), collects the picks, and submits
 * a UserAnswers back to the sidecar. Single-select uses radio semantics;
 * multiSelect toggles.
 */
export default function QuestionPrompt({ questions, onSubmit, onDismiss }: Props): JSX.Element {
  const [picked, setPicked] = useState<string[][]>(() => questions.map(() => []));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));

  function toggleOption(qi: number, label: string): void {
    setPicked((prev) => {
      const next = prev.map((a) => a.slice());
      const cur = next[qi];
      if (questions[qi].multiSelect) {
        const at = cur.indexOf(label);
        if (at >= 0) cur.splice(at, 1);
        else cur.push(label);
      } else {
        next[qi] = cur[0] === label ? [] : [label]; // radio: replaces (clears OTHER too)
      }
      return next;
    });
  }

  function setOtherText(qi: number, value: string): void {
    setOther((prev) => {
      const n = prev.slice();
      n[qi] = value;
      return n;
    });
    setPicked((prev) => {
      const next = prev.map((a) => a.slice());
      if (questions[qi].multiSelect) {
        const has = next[qi].includes(OTHER);
        if (value && !has) next[qi].push(OTHER);
        if (!value && has) next[qi] = next[qi].filter((l) => l !== OTHER);
      } else {
        next[qi] = value ? [OTHER] : [];
      }
      return next;
    });
  }

  function answered(qi: number): boolean {
    const hasOption = picked[qi].some((l) => l !== OTHER);
    const hasOther = picked[qi].includes(OTHER) && other[qi].trim() !== '';
    return hasOption || hasOther;
  }

  const allAnswered = questions.every((_, qi) => answered(qi));

  function submit(): void {
    const answers: QuestionAnswer[] = questions.map((q, qi) => {
      const selected = picked[qi].filter((l) => l !== OTHER);
      const otherText = picked[qi].includes(OTHER) ? other[qi].trim() : '';
      return {
        header: q.header,
        question: q.question,
        selected,
        ...(otherText ? { otherText } : {}),
      };
    });
    onSubmit({ answers });
  }

  return (
    <div className="question-prompt">
      {questions.map((q, qi) => (
        <div key={qi} className="qp-block">
          <div className="qp-header">{q.header}</div>
          <div className="qp-question">{q.question}</div>
          <div className="qp-options">
            {q.options.map((o) => {
              const on = picked[qi].includes(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  className={`qp-option${on ? ' on' : ''}`}
                  onClick={() => toggleOption(qi, o.label)}
                >
                  <span className="qp-opt-label">{o.label}</span>
                  {o.description && <span className="qp-opt-desc">{o.description}</span>}
                </button>
              );
            })}
            <div className={`qp-option qp-other${picked[qi].includes(OTHER) ? ' on' : ''}`}>
              <input
                type="text"
                placeholder="직접 입력…"
                value={other[qi]}
                onChange={(e) => setOtherText(qi, e.target.value)}
              />
            </div>
          </div>
        </div>
      ))}
      <div className="qp-actions">
        <button type="button" className="btn ghost" onClick={onDismiss}>
          건너뛰기
        </button>
        <button type="button" className="btn primary" disabled={!allAnswered} onClick={submit}>
          확인
        </button>
      </div>
    </div>
  );
}
