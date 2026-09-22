import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import * as fabric from 'fabric';
import { Upload, Undo2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import './Smartboard.css';

const PEN_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#111827'];
const STAGE_W = 1000;
const STAGE_H = 562; // 16:9 — the drawing canvas is always this size; slide images letterbox inside it via object-fit.
const SAVE_DEBOUNCE_MS = 1200;

/**
 * Teacher-facing smartboard for a lecture: upload a slide deck (PDF), navigate slides,
 * freehand-draw on the current one. Which slides were actually shown, and what was drawn
 * on each, is what later powers the student recap page (see server/routes/smartboard.js).
 *
 * Drawing intentionally supports pen + undo + clear-all, not pixel erasing — precise erasing
 * over a background image is fragile and isn't what a teacher needs mid-lecture; undo covers
 * "I meant to draw that on the last stroke, not this one."
 */
export default function Smartboard({ meetingId, slideDeck, onSlideDeckChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const saveTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadingSlideRef = useRef(false); // guards against autosave firing while we're loading a slide's saved strokes

  const slides = slideDeck?.slides || [];
  const currentSlide = slides[currentIndex] || null;
  const hasDeck = slides.length > 0;

  // --- Fabric canvas lifecycle -------------------------------------------------

  useEffect(() => {
    if (!canvasElRef.current) return undefined;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      isDrawingMode: !disabled,
      selection: false,
      width: STAGE_W,
      height: STAGE_H,
    });
    fabricRef.current = canvas;
    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = !disabled;
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = brushWidth;
  }, [color, brushWidth, disabled]);

  const flushSave = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !currentSlide || loadingSlideRef.current) return;
    setSaveStatus('saving');
    try {
      const json = canvas.toJSON();
      await axios.put(`/meetings/${meetingId}/slides/${currentSlide.index}/annotations`, { annotations: json });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('idle');
    }
  }, [meetingId, currentSlide]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return undefined;
    const onChange = () => {
      if (!loadingSlideRef.current) scheduleSave();
    };
    canvas.on('path:created', onChange);
    canvas.on('object:modified', onChange);
    return () => {
      canvas.off('path:created', onChange);
      canvas.off('object:modified', onChange);
    };
  }, [scheduleSave]);

  // --- Slide navigation: save current, mark new one shown, load its strokes ----

  const goToSlide = useCallback(
    async (nextIndex) => {
      const canvas = fabricRef.current;
      if (!canvas || nextIndex < 0 || nextIndex >= slides.length) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await flushSave();

      loadingSlideRef.current = true;
      canvas.clear();
      const target = slides[nextIndex];
      try {
        if (target?.annotations) {
          await canvas.loadFromJSON(target.annotations);
          canvas.renderAll();
        }
      } catch {
        canvas.clear();
      }
      loadingSlideRef.current = false;

      setCurrentIndex(nextIndex);
      setSaveStatus('idle');
      // Fire-and-forget — the recap only needs shownAt set, no need to block navigation on it.
      axios.post(`/meetings/${meetingId}/slides/${target.index}/shown`).catch(() => {});
    },
    [slides, flushSave, meetingId]
  );

  // Mark the first slide shown as soon as a fresh deck loads (teacher is looking at it now).
  useEffect(() => {
    if (hasDeck && currentIndex === 0) {
      axios.post(`/meetings/${meetingId}/slides/${slides[0].index}/shown`).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideDeck?.uploadedAt]);

  // --- Upload --------------------------------------------------------------

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('deck', file);
      const res = await axios.post(`/meetings/${meetingId}/slides`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSlideDeckChange?.(res.data.slideDeck);
      setCurrentIndex(0);
      fabricRef.current?.clear();
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Could not process that PDF.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Toolbar actions -------------------------------------------------------

  const handleUndo = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objects = canvas.getObjects();
    if (objects.length === 0) return;
    canvas.remove(objects[objects.length - 1]);
    scheduleSave();
  };

  const handleClear = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.clear();
    scheduleSave();
  };

  return (
    <section className="smartboard" aria-label="Smartboard">
      <div className="smartboard__head">
        <h2 className="smartboard__title">Smartboard</h2>
        {hasDeck && (
          <span className="smartboard__save-status" aria-live="polite">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
          </span>
        )}
      </div>

      {!hasDeck ? (
        <div className="smartboard__empty">
          <p>Upload this lecture's slides as a PDF to draw on them live and give students a slide-by-slide recap.</p>
          <label className="smartboard__upload-btn">
            <Upload size={16} strokeWidth={2} aria-hidden />
            {uploading ? 'Uploading…' : 'Upload slide deck (PDF)'}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleUpload}
              disabled={uploading || disabled}
              hidden
            />
          </label>
          {uploadError && <p className="smartboard__error">{uploadError}</p>}
        </div>
      ) : (
        <>
          <div className="smartboard__toolbar">
            <div className="smartboard__colors">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`smartboard__color-swatch${color === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Pen color ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <input
              type="range"
              min="1"
              max="12"
              value={brushWidth}
              onChange={(e) => setBrushWidth(Number(e.target.value))}
              className="smartboard__width-slider"
              aria-label="Pen thickness"
            />
            <button type="button" className="smartboard__tool-btn" onClick={handleUndo} title="Undo last stroke">
              <Undo2 size={16} strokeWidth={2} aria-hidden /> Undo
            </button>
            <button type="button" className="smartboard__tool-btn" onClick={handleClear} title="Clear this slide">
              <Trash2 size={16} strokeWidth={2} aria-hidden /> Clear
            </button>
          </div>

          <div className="smartboard__stage" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
            {currentSlide && (
              <img className="smartboard__slide-img" src={currentSlide.imageUrl} alt={`Slide ${currentIndex + 1}`} />
            )}
            <canvas ref={canvasElRef} className="smartboard__canvas" />
          </div>

          <div className="smartboard__nav">
            <button
              type="button"
              className="smartboard__nav-btn"
              onClick={() => goToSlide(currentIndex - 1)}
              disabled={currentIndex === 0}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden /> Prev
            </button>
            <span className="smartboard__nav-count">
              Slide {currentIndex + 1} of {slides.length}
            </span>
            <button
              type="button"
              className="smartboard__nav-btn"
              onClick={() => goToSlide(currentIndex + 1)}
              disabled={currentIndex === slides.length - 1}
            >
              Next <ChevronRight size={16} strokeWidth={2} aria-hidden />
            </button>
            <label className="smartboard__upload-btn smartboard__upload-btn--compact">
              <Upload size={14} strokeWidth={2} aria-hidden />
              Replace deck
              <input type="file" accept="application/pdf" onChange={handleUpload} disabled={uploading || disabled} hidden />
            </label>
          </div>
        </>
      )}
    </section>
  );
}
