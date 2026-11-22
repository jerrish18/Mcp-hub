import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  RotateCcw,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import type { StudyFlashcard } from '../../utils/studyTools';

interface StudyFlashcardsModalProps {
  open: boolean;
  title?: string;
  cards: StudyFlashcard[];
  onClose: () => void;
  onGenerateDeepDeck?: () => void;
}

export function StudyFlashcardsModal({
  open,
  title,
  cards: initialCards,
  onClose,
  onGenerateDeepDeck,
}: StudyFlashcardsModalProps) {
  const [deck, setDeck] = useState<StudyFlashcard[]>(initialCards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [masteredIds, setMasteredIds] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDeck(initialCards);
    setIndex(0);
    setFlipped(false);
    setMasteredIds(new Set());
    setReviewIds(new Set());
  }, [initialCards, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (e.key === 'ArrowRight' && deck.length > 0) {
        setFlipped(false);
        setIndex((i) => Math.min(deck.length - 1, i + 1));
      }
      if (e.key === 'ArrowLeft' && deck.length > 0) {
        setFlipped(false);
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, deck.length]);

  if (!open) return null;

  const currentCard = deck[index];
  const masteredCount = masteredIds.size;
  const totalCount = deck.length;
  const progressPct = totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  const handleShuffle = () => {
    const copy = [...deck];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    setDeck(copy);
    setIndex(0);
    setFlipped(false);
  };

  const handleMark = (status: 'mastered' | 'review') => {
    if (!currentCard) return;
    const nextMastered = new Set(masteredIds);
    const nextReview = new Set(reviewIds);
    if (status === 'mastered') {
      nextMastered.add(currentCard.id);
      nextReview.delete(currentCard.id);
    } else {
      nextReview.add(currentCard.id);
      nextMastered.delete(currentCard.id);
    }
    setMasteredIds(nextMastered);
    setReviewIds(nextReview);
    setFlipped(false);
    if (index + 1 < deck.length) {
      setIndex(index + 1);
    }
  };

  const handleReviewMissedOnly = () => {
    const missed = initialCards.filter((c) => reviewIds.has(c.id));
    if (missed.length === 0) return;
    setDeck(missed);
    setIndex(0);
    setFlipped(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Study Flashcards"
      data-testid="study-flashcards-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
    >
      <div
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="w-full max-w-xl rounded-[28px] border p-5 sm:p-6 shadow-2xl space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
            >
              <Layers className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-slate-950 dark:text-white truncate">
                {title || 'Active Recall Flashcards'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {totalCount > 0
                  ? `Card ${index + 1} of ${totalCount} · ${masteredCount} mastered (${progressPct}%)`
                  : 'Generate a deck from this topic'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Flashcards"
            className="min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mastery Progress Bar */}
        {totalCount > 0 && (
          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              style={{
                width: `${progressPct}%`,
                backgroundColor: 'var(--m3-primary)',
              }}
              className="h-full transition-all duration-300"
            />
          </div>
        )}

        {/* Flashcard Stage */}
        {currentCard ? (
          <div className="space-y-4">
            <button
              type="button"
              data-testid="flashcard-flip-surface"
              onClick={() => setFlipped((f) => !f)}
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: flipped ? 'var(--m3-primary)' : 'var(--m3-outline)',
              }}
              className="w-full min-h-[220px] sm:min-h-[250px] rounded-[24px] border p-6 sm:p-8 flex flex-col items-center justify-center text-center transition-colors shadow-xs"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
                {flipped ? 'Answer' : 'Question · Tap to reveal'}
              </span>
              <p className="font-display text-lg sm:text-xl font-semibold text-slate-950 dark:text-white leading-snug max-w-[44ch]">
                {flipped ? currentCard.back : currentCard.front}
              </p>
              {flipped && currentCard.memoryHook && (
                <p
                  style={{ color: 'var(--m3-primary)' }}
                  className="mt-4 text-xs sm:text-sm font-medium max-w-[46ch]"
                >
                  Memory Hook: {currentCard.memoryHook}
                </p>
              )}
            </button>

            {/* Spaced Repetition Self-Grading + Navigation */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFlipped(false);
                    setIndex((i) => Math.max(0, i - 1));
                  }}
                  disabled={index === 0}
                  aria-label="Previous card"
                  className="min-h-[42px] min-w-[42px] rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFlipped(false);
                    setIndex((i) => Math.min(deck.length - 1, i + 1));
                  }}
                  disabled={index >= deck.length - 1}
                  aria-label="Next card"
                  className="min-h-[42px] min-w-[42px] rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 disabled:opacity-40"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleShuffle}
                  aria-label="Shuffle cards"
                  className="min-h-[42px] px-3 rounded-full border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Shuffle</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleMark('review')}
                  className="min-h-[42px] px-4 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs font-semibold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Still Learning</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMark('mastered')}
                  className="min-h-[42px] px-4 rounded-full bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Got It</span>
                </button>
              </div>
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
              No structured Q&A or key concepts were found in this message yet.
            </p>
            {onGenerateDeepDeck && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGenerateDeepDeck();
                }}
                style={{
                  backgroundColor: 'var(--m3-primary)',
                  color: 'var(--m3-on-primary)',
                }}
                className="min-h-[44px] px-5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Generate 6 AI Flashcards</span>
              </button>
            )}
          </div>
        )}

        {/* Footer Helpers */}
        {(reviewIds.size > 0 || onGenerateDeepDeck) && totalCount > 0 && (
          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            {reviewIds.size > 0 ? (
              <button
                type="button"
                onClick={handleReviewMissedOnly}
                className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
              >
                Drill {reviewIds.size} missed card{reviewIds.size === 1 ? '' : 's'}
              </button>
            ) : (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Space to flip · Arrows to navigate
              </span>
            )}

            {onGenerateDeepDeck && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGenerateDeepDeck();
                }}
                style={{ color: 'var(--m3-primary)' }}
                className="text-xs font-semibold inline-flex items-center gap-1 hover:underline"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate New AI Deck</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
