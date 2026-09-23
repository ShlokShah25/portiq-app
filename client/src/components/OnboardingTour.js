import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './OnboardingTour.css';

/**
 * Reusable, multi-step guided tour with a REAL spotlight cutout.
 *
 * Why not `z-index` on the real target element?
 * A naive "spotlight" raises the real target above a dark backdrop with a
 * higher `z-index`. That only works if the target's ancestors never create
 * their own CSS stacking context. Any ancestor with `transform`, `filter`,
 * `opacity < 1`, `will-change`, or a running CSS `animation` with
 * `animation-fill-mode: forwards` creates one — and once that happens the
 * child's z-index is scoped *inside* that ancestor's stacking context, so it
 * can never paint above a sibling (like a full-screen backdrop) that lives
 * outside it, no matter how high the z-index number is. That is exactly what
 * happened with the old teacher tour: its fields sit inside a
 * `.ux-dashboard-stagger` section, and `.ux-dashboard-stagger` runs a
 * `forwards`-filled entrance animation, so `z-index: 1202` on the field never
 * actually beat the backdrop's `z-index: 1200`.
 *
 * This component sidesteps the whole problem: instead of trying to lift the
 * real element above a backdrop, it punches a literal hole in the backdrop
 * using an SVG `<mask>` (a white full-viewport rect with a black rounded
 * rect cut out at the target's `getBoundingClientRect()`). The "hole" is
 * genuinely transparent, so the real target — wherever it lives in the DOM,
 * whatever stacking context its ancestors create — simply shows through
 * undimmed, exactly as it always renders. Nothing about the target's own
 * z-index or stacking context matters.
 */

const DEFAULT_PADDING = 8;
const VIEWPORT_MARGIN = 16;
const CARD_GAP = 14;

/** Has this tour already been dismissed once (Skip or Finish) for this key? */
export function hasSeenTour(storageKey) {
  if (!storageKey) return false;
  try {
    return window.localStorage.getItem(storageKey) === '1';
  } catch (_) {
    return false;
  }
}

/** Mark a tour as seen so it will not auto-open again for this key. */
export function markTourSeen(storageKey) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, '1');
  } catch (_) {
    // ignore (private mode / storage disabled)
  }
}

function resolveTargetEl(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    try {
      return document.querySelector(target);
    } catch (_) {
      return null;
    }
  }
  if (typeof target === 'object' && 'current' in target) {
    return target.current || null;
  }
  return null;
}

let maskIdCounter = 0;

export default function OnboardingTour({
  steps,
  open,
  currentStep,
  onNext,
  onBack,
  onSkip,
  onFinish,
  storageKey,
  padding = DEFAULT_PADDING,
}) {
  const maskId = useMemo(() => `onboarding-tour-mask-${++maskIdCounter}`, []);
  const [spotlight, setSpotlight] = useState(null); // {top,left,width,height} in viewport px, or null
  const [cardPos, setCardPos] = useState(null); // {top,left} or null (= centered)
  const cardRef = useRef(null);
  const step = steps && steps.length ? steps[Math.min(currentStep, steps.length - 1)] : null;
  const StepIcon = step?.icon;

  const handleSkip = () => {
    markTourSeen(storageKey);
    if (onSkip) onSkip();
  };

  const handleFinish = () => {
    markTourSeen(storageKey);
    if (onFinish) onFinish();
  };

  const recompute = () => {
    if (!step) {
      setSpotlight(null);
      setCardPos(null);
      return;
    }
    const el = resolveTargetEl(step.target);
    if (!el) {
      // Target not found (not mounted yet, or this step is deliberately
      // spotlight-less). Fall back to a centered card rather than crashing
      // or guessing — the parent can always add the target later and the
      // tour will pick it up on the next recompute tick.
      setSpotlight(null);
      setCardPos(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const top = rect.top - padding;
    const left = rect.left - padding;
    const width = rect.width + padding * 2;
    const height = rect.height + padding * 2;
    setSpotlight({ top, left, width, height });
    setCardPos((prev) => {
      const guessTop = top + height + CARD_GAP;
      const guessLeft = Math.max(VIEWPORT_MARGIN, left);
      if (prev && Math.abs(prev.top - guessTop) < 1 && Math.abs(prev.left - guessLeft) < 1) {
        return prev;
      }
      return { top: guessTop, left: guessLeft };
    });
  };

  // Recompute on open/step change, on resize/scroll (mirrors the previous
  // debug logic), and on a short poll — the poll matters for steps whose
  // target mounts asynchronously (e.g. the Smartboard toolbar only exists
  // once a deck/whiteboard page has been created).
  useEffect(() => {
    if (!open) return undefined;
    recompute();
    const onResize = () => recompute();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const pollId = window.setInterval(recompute, 400);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.clearInterval(pollId);
    };
    // Intentionally keyed on step?.target (not the whole `step` object or
    // `recompute`, which is re-created every render) so this effect only
    // re-subscribes when the tour actually opens or moves to a new step.
  }, [open, currentStep, step?.target]);

  // Escape closes the tour like clicking the backdrop.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // handleSkip is a small closure re-created each render; re-running this
    // effect only on `open` (not on every render) is intentional.
  }, [open]);

  // After the card renders at its guessed position, clamp it into the
  // viewport using its real measured size (fixes long-body steps that would
  // otherwise overflow the bottom/right edge).
  useLayoutEffect(() => {
    if (!open || !cardPos) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { top, left } = cardPos;
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      // Not enough room below the target — try above it instead.
      const above = spotlight ? spotlight.top - rect.height - CARD_GAP : top;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    }
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    }
    if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
    if (Math.abs(top - cardPos.top) < 1 && Math.abs(left - cardPos.left) < 1) return;
    setCardPos({ top, left });
    // Only re-runs when open/cardPos/spotlight change; it sets cardPos
    // itself but bails out above once the position has converged, so this
    // does not loop.
  }, [open, cardPos, spotlight]);

  if (!open || !step) return null;

  const isFirst = currentStep <= 0;
  const isLast = currentStep >= steps.length - 1;

  const cardStyle = cardPos
    ? { position: 'fixed', top: `${cardPos.top}px`, left: `${cardPos.left}px` }
    : undefined;

  return (
    <div className="onboarding-tour" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="onboarding-tour__click-catcher" onClick={handleSkip} />
      <svg className="onboarding-tour__mask-svg" aria-hidden="true">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx="12"
                ry="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(8, 11, 22, 0.66)"
          mask={`url(#${maskId})`}
        />
      </svg>
      {spotlight && (
        <div
          className="onboarding-tour__ring"
          style={{
            top: `${spotlight.top}px`,
            left: `${spotlight.left}px`,
            width: `${spotlight.width}px`,
            height: `${spotlight.height}px`,
          }}
        />
      )}
      <div
        ref={cardRef}
        className={`onboarding-tour__card${cardPos ? ' onboarding-tour__card--spotlight' : ' onboarding-tour__card--centered'}`}
        style={cardStyle}
      >
        <div className="onboarding-tour__card-accent" aria-hidden />
        <div className="onboarding-tour__head">
          {StepIcon ? (
            <div className="onboarding-tour__icon-wrap">
              <StepIcon className="onboarding-tour__icon" size={26} strokeWidth={1.75} aria-hidden />
            </div>
          ) : null}
          <div className="onboarding-tour__head-text">
            <p className="onboarding-tour__eyebrow">Quick tour</p>
            <p className="onboarding-tour__step">
              Step {currentStep + 1} of {steps.length}
            </p>
          </div>
        </div>
        <div className="onboarding-tour__dots" role="tablist" aria-label="Tour progress">
          {steps.map((s, i) => (
            <span
              key={s.id || String(i)}
              className={
                i === currentStep
                  ? 'onboarding-tour__dot onboarding-tour__dot--active'
                  : 'onboarding-tour__dot'
              }
            />
          ))}
        </div>
        <h3 className="onboarding-tour__title">{step.title}</h3>
        <p className="onboarding-tour__body">{step.body}</p>
        <div className="onboarding-tour__actions">
          <button type="button" className="onboarding-tour__btn onboarding-tour__btn--ghost" onClick={handleSkip}>
            Skip
          </button>
          {!isFirst && (
            <button type="button" className="onboarding-tour__btn onboarding-tour__btn--ghost" onClick={onBack}>
              Back
            </button>
          )}
          {!isLast ? (
            <button type="button" className="onboarding-tour__btn onboarding-tour__btn--primary" onClick={onNext}>
              Next
            </button>
          ) : (
            <button type="button" className="onboarding-tour__btn onboarding-tour__btn--primary" onClick={handleFinish}>
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
