import React, { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';

// Same fixed drawing space the teacher's Smartboard uses (see Smartboard.js). Each page is
// zoomed to whatever width it is shown at, so notes sit exactly where the teacher drew them.
export const STAGE_W = 1000;
export const STAGE_H = 562;

export function hasDrawing(page) {
  return Boolean(page?.annotations && Array.isArray(page.annotations.objects) && page.annotations.objects.length > 0);
}

/**
 * Not importing a stylesheet on purpose: the student recap and the teacher's recap panel both
 * use this and load in different chunks (a shared stylesheet there breaks the CRA build).
 * Each page styles the lecture-recap-page* class names itself.
 *
 * One page from the lecture — a slide image or a blank whiteboard page — with the teacher's
 * drawing rendered on top, read-only, at whatever size the box is.
 *
 * The <canvas> is created by hand inside a host <div>. Fabric restyles and (for interactive
 * canvases) re-parents its canvas element; keeping it out of React's tree means React never
 * tries to move a node Fabric has taken over.
 */
export default function PageCanvas({ page, alt }) {
  const stageRef = useRef(null);
  const hostRef = useRef(null);
  const [imageFailed, setImageFailed] = useState(false);
  const isWhiteboard = page.type === 'whiteboard';
  const annotations = hasDrawing(page) ? page.annotations : null;

  useEffect(() => {
    setImageFailed(false);
  }, [page.imageUrl]);

  useEffect(() => {
    const host = hostRef.current;
    const stage = stageRef.current;
    if (!host || !stage || !annotations) return undefined;

    const el = document.createElement('canvas');
    host.appendChild(el);
    const canvas = new fabric.StaticCanvas(el, { width: STAGE_W, height: STAGE_H });
    let gone = false;
    const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;

    const fit = () => {
      if (gone) return;
      const width = Math.round(stage.clientWidth);
      if (!width) return;
      const height = Math.round((width * STAGE_H) / STAGE_W);
      if (canvas.width !== width || canvas.height !== height) canvas.setDimensions({ width, height });
      canvas.setZoom(width / STAGE_W);
      canvas.requestRenderAll();
    };

    canvas
      .loadFromJSON(annotations, undefined, abort ? { signal: abort.signal } : undefined)
      .then(fit)
      .catch(() => {});

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(fit);
      observer.observe(stage);
    } else {
      window.addEventListener('resize', fit);
    }

    return () => {
      gone = true;
      if (abort) abort.abort();
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', fit);
      canvas.dispose().catch(() => {});
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [annotations]);

  return (
    <div
      ref={stageRef}
      className={`lecture-recap-page${isWhiteboard ? ' lecture-recap-page--whiteboard' : ''}`}
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
    >
      {isWhiteboard ? (
        <div className="lecture-recap-page__paper" aria-hidden />
      ) : imageFailed ? (
        <div className="lecture-recap-page__missing">This slide's image is no longer available.</div>
      ) : (
        <img
          className="lecture-recap-page__img"
          src={page.imageUrl}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      )}
      <div ref={hostRef} className="lecture-recap-page__ink" aria-hidden />
    </div>
  );
}
