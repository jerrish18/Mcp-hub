import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import type { StudyQuizQuestion } from '../../utils/studyTools';

interface StudyQuizModalProps {
  open: boolean;
  title?: string;
  questions: StudyQuizQuestion[];
  onClose: () => void;
  onGenerateAiQuiz?: () => void;
  onReviewMistakes?: (missedSummary: string) => void;
}

export function StudyQuizModal({
  open,
  title,
  questions,
  onClose,
  onGenerateAiQuiz,
  onReviewMistakes,
}: StudyQuizModalProps) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    setAnswers({});
    setCurrentIdx(0);
  }, [questions, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = questions[currentIdx];
  const selectedOpt = q ? answers[q.id] : undefined;
  const hasAnswered = selectedOpt !== undefined;

  const answeredCount = questions.filter((item) => answers[item.id] !== undefined).length;
  const correctCount = questions.filter((item) => answers[item.id] === item.correctIndex).length;
  const allDone = questions.length > 0 && answeredCount === questions.length;
  const missedQuestions = questions.filter(
    (item) => answers[item.id] !== undefined && answers[item.id] !== item.correctIndex
  );

  const handleSelectOption = (optionIdx: number) => {
    if (!q || hasAnswered) return;
    setAnswers((prev) => ({ ...prev, [q.id]: optionIdx }));
  };

  const handleReviewMissed = () => {
    if (!onReviewMistakes || missedQuestions.length === 0) return;
    const summary = missedQuestions
      .map(
        (m) =>
          `- Question: "${m.question}" (I picked "${m.options[answers[m.id]] ?? 'unknown'}", correct answer is "${m.options[m.correctIndex]}")`
      )
      .join('\n');
    onClose();
    onReviewMistakes(summary);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Practice Quiz"
      data-testid="study-quiz-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
    >
      <div
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-[28px] border p-5 sm:p-6 shadow-2xl space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            >
              <HelpCircle className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white truncate">
                {title || 'Practice Check Quiz'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {questions.length > 0
                  ? `Question ${currentIdx + 1} of ${questions.length} · Score: ${correctCount}/${answeredCount}`
                  : 'Generate a 4-question multiple-choice quiz'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Practice Quiz"
            className="min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {q ? (
          <div className="space-y-4">
            <div
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-2xl border p-4 sm:p-5 space-y-4"
            >
              <h3 className="font-display text-base font-semibold text-slate-950 dark:text-white leading-snug">
                {q.question}
              </h3>

              <div className="space-y-2">
                {q.options.map((opt, oi) => {
                  const isSelected = selectedOpt === oi;
                  const isCorrect = oi === q.correctIndex;
                  const letter = ['A', 'B', 'C', 'D'][oi] ?? String(oi + 1);

                  let stateStyle: React.CSSProperties = {
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  };
                  let stateLabel = '';
                  if (hasAnswered) {
                    if (isCorrect) {
                      stateStyle = {
                        backgroundColor: 'rgba(16, 185, 129, 0.14)',
                        borderColor: '#10B981',
                      };
                      stateLabel = 'Correct';
                    } else if (isSelected && !isCorrect) {
                      stateStyle = {
                        backgroundColor: 'rgba(244, 63, 94, 0.14)',
                        borderColor: '#F43F5E',
                      };
                      stateLabel = 'Incorrect';
                    }
                  }

                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={hasAnswered}
                      onClick={() => handleSelectOption(oi)}
                      style={stateStyle}
                      className="w-full min-h-[48px] px-3.5 py-2.5 rounded-2xl border text-left text-sm flex items-center justify-between gap-3 transition-colors disabled:cursor-default"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span className="w-6 h-6 rounded-full bg-slate-200/80 dark:bg-slate-800 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 text-slate-700 dark:text-slate-200">
                          {letter}
                        </span>
                        <span className="text-slate-900 dark:text-slate-100 leading-snug">{opt}</span>
                      </div>
                      {hasAnswered && isCorrect && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{stateLabel}</span>
                        </span>
                      )}
                      {hasAnswered && isSelected && !isCorrect && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 shrink-0">
                          <XCircle className="w-4 h-4" />
                          <span>{stateLabel}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {hasAnswered && (
                <div
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-xl border p-3.5 text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-200"
                >
                  <span className="font-semibold text-slate-950 dark:text-white">Explanation: </span>
                  {q.explanation}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setAnswers({});
                    setCurrentIdx(0);
                  }}
                  className="min-h-[40px] px-3.5 rounded-full border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
                {allDone && missedQuestions.length > 0 && onReviewMistakes && (
                  <button
                    type="button"
                    onClick={handleReviewMissed}
                    className="min-h-[40px] px-3.5 rounded-full bg-amber-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Review {missedQuestions.length} Missed with Tutor</span>
                  </button>
                )}
              </div>

              {currentIdx + 1 < questions.length ? (
                <button
                  type="button"
                  onClick={() => setCurrentIdx((i) => Math.min(questions.length - 1, i + 1))}
                  style={{
                    backgroundColor: 'var(--m3-primary)',
                    color: 'var(--m3-on-primary)',
                  }}
                  className="min-h-[42px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1"
                >
                  <span>Next Question</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    backgroundColor: 'var(--m3-primary)',
                    color: 'var(--m3-on-primary)',
                  }}
                  className="min-h-[42px] px-5 rounded-full text-xs font-semibold"
                >
                  {allDone ? `Finish (${correctCount}/${questions.length})` : 'Done'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-2xl border p-6 text-center space-y-3"
          >
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ready to test yourself? Let the Study Tutor generate 4 interactive MCQs with instant explanations.
            </p>
            {onGenerateAiQuiz && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGenerateAiQuiz();
                }}
                style={{
                  backgroundColor: 'var(--m3-primary)',
                  color: 'var(--m3-on-primary)',
                }}
                className="min-h-[44px] px-5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Generate Practice Quiz</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
