import React from 'react';
// Skeleton.css is imported once in src/index.js. This component is used from several lazily
// loaded pages; importing the stylesheet here put it in more than one CSS chunk, which is the
// "Conflicting order" build failure this project has hit twice before.

/**
 * A shimmering placeholder block, shaped like the content that's about to load.
 * Used instead of a bare spinner/"Loading…" text wherever the eventual layout is
 * known ahead of time — a skeleton the same shape as the real content reads as
 * "fast and considered" even when the actual load time is unchanged.
 */
export default function Skeleton({ width, height = '1em', radius = 6, style, className = '' }) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{ width: width ?? '100%', height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

/** A stack of skeleton lines, e.g. for a paragraph or list row of unknown final content. */
export function SkeletonLines({ count = 3, lastWidth = '60%', gap = 8 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} width={i === count - 1 ? lastWidth : '100%'} height={12} />
      ))}
    </div>
  );
}
