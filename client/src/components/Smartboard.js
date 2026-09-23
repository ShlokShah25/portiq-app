import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import * as fabric from 'fabric';
import {
  Upload,
  Undo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Presentation,
  PenLine,
  Eraser,
  Plus,
} from 'lucide-react';
import './Smartboard.css';

const PEN_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#111827'];
const STAGE_W = 1000;
const STAGE_H = 562; // 16:9 — the drawing canvas is always this size; slide images letterbox inside it via object-fit.
const SAVE_DEBOUNCE_MS = 1200;
const MAX_WHITEBOARD_PAGES = 30; // mirrors server/routes/smartboard.js MAX_WHITEBOARD_PAGES

/**
 * Teacher-facing smartboard for a lecture. Two interchangeable page sources feed the
 * same drawing canvas:
 *  - "slides": an uploaded PDF deck rasterized to one image per page (drawn on top of).
 *  - "whiteboard": blank pages, drawn on with nothing underneath.
 * A teacher can switch between the two mid-lecture (e.g. show a slide, then flip to a
 * blank page to work through a problem, then back). Which pages were actually shown,
 * and what was drawn on each, is what later powers the student recap page — see
 * server/routes/smartboard.js, which merges both into one chronological timeline.
 *
 * Drawing supports a pen (5 colors + width) and an object-eraser (click a stroke to
 * remove it) rather than pixel erasing — precise pixel erasing over a background slide
 * image is fragile and isn't what a teacher needs mid-lecture; undo + object-erase +
 * clear-all cover every real correction a teacher needs to make live.
 */
export default function Smartboard({
  meetingId,
  slideDeck,
  onSlideDeckChange,
  whiteboard,
  onWhiteboardChange,
  disabled,
}) {
  const [mode, setMode] = useState('slides'); // 'slides' | 'whiteboard'
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [addingPage, setAddingPage] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [wbIndex, setWbIndex] = useState(0);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser'
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const saveTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadingPageRef = useRef(false); // guards against autosave firing while we're loading a page's saved strokes

  const slides = slideDeck?.slides || [];
  const wbPages = whiteboard?.pages || [];
  const hasDeck = slides.length > 0;
  const hasWbPages = wbPages.length > 0;

  const currentPage = useMemo(
    () => (mode === 'slides' ? slides[slideIndex] || null : wbPages[wbIndex] || null),
    [mode, slides, slideIndex, wbPages, wbIndex]
  );
  const currentPageNumber = mode === 'slides' ? slideIndex + 1 : wbIndex + 1;
  const currentPageTotal = mode === 'slides' ? slides.length : wbPages.length;

  // Switching to a mode that has no pages yet (fresh whiteboard) shouldn't show a
  // canvas with nothing to draw on — treat it as an empty state prompting "Add a page".
  const showsCanvas = mode === 'slides' ? hasDeck : hasWbPages;

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
    // Fabric canvas is created once per mount; tool/disabled are applied by the effect below.
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = !disabled && tool === 'pen';
    canvas.selection = false;
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = brushWidth;
    canvas.defaultCursor = tool === 'eraser' ? 'crosshair' : 'default';
    canvas.hoverCursor = tool === 'eraser' ? 'crosshair' : 'move';
  }, [color, brushWidth, tool, disabled]);

  // Eraser: click a stroke to remove it (object-level, not pixel — see file header).
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return undefined;
    const onMouseDown = (opt) => {
      if (tool !== 'eraser' || disabled) return;
      const pointer = canvas.getPointer(opt.e);
      const objects = canvas.getObjects();
      for (let i = objects.length - 1; i >= 0; i -= 1) {
        if (objects[i].containsPoint(pointer)) {
          canvas.remove(objects[i]);
          scheduleSaveRef.current?.();
          break;
        }
      }
    };
    canvas.on('mouse:down', onMouseDown);
    return () => canvas.off('mouse:down', onMouseDown);
  }, [tool, disabled]);

  const pageEndpoint = useCallback(
    (m, idx) =>
      m === 'slides'
        ? `/meetings/${meetingId}/slides/${idx}/annotations`
        : `/meetings/${meetingId}/whiteboard/pages/${idx}/annotations`,
    [meetingId]
  );
  const shownEndpoint = useCallback(
    (m, idx) =>
      m === 'slides' ? `/meetings/${meetingId}/slides/${idx}/shown` : `/meetings/${meetingId}/whiteboard/pages/${idx}/shown`,
    [meetingId]
  );

  const flushSave = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas || !currentPage || loadingPageRef.current) return;
    setSaveStatus('saving');
    try {
      const json = canvas.toJSON();
      await axios.put(pageEndpoint(mode, currentPage.index), { annotations: json });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('idle');
    }
  }, [mode, currentPage, pageEndpoint]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }, [flushSave]);
  // Ref mirror so the eraser's mouse:down handler (defined above flushSave in file
  // order) always calls the latest scheduleSave without re-subscribing every render.
  const scheduleSaveRef = useRef(scheduleSave);
  useEffect(() => {
    scheduleSaveRef.current = scheduleSave;
  }, [scheduleSave]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return undefined;
    const onChange = () => {
      if (!loadingPageRef.current) scheduleSave();
    };
    canvas.on('path:created', onChange);
    canvas.on('object:modified', onChange);
    return () => {
      canvas.off('path:created', onChange);
      canvas.off('object:modified', onChange);
    };
  }, [scheduleSave]);

  // --- Load a page's saved strokes onto the canvas (shared by mode-switch + page-nav) --

  const loadPageOntoCanvas = useCallback(async (page) => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    loadingPageRef.current = true;
    canvas.clear();
    try {
      if (page?.annotations) {
        await canvas.loadFromJSON(page.annotations);
        canvas.renderAll();
      }
    } catch {
      canvas.clear();
    }
    loadingPageRef.current = false;
  }, []);

  // --- Page navigation within the current mode ---------------------------------

  const goToPage = useCallback(
    async (nextIndex) => {
      const list = mode === 'slides' ? slides : wbPages;
      if (nextIndex < 0 || nextIndex >= list.length) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await flushSave();

      const target = list[nextIndex];
      await loadPageOntoCanvas(target);

      if (mode === 'slides') setSlideIndex(nextIndex);
      else setWbIndex(nextIndex);
      setSaveStatus('idle');
      // Fire-and-forget — the recap only needs shown/touched set, no need to block navigation on it.
      axios.post(shownEndpoint(mode, target.index)).catch(() => {});
    },
    [mode, slides, wbPages, flushSave, loadPageOntoCanvas, shownEndpoint]
  );

  // --- Mode switching: save current page, load the other mode's current page ----

  const switchMode = useCallback(
    async (nextMode) => {
      if (nextMode === mode) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      await flushSave();

      const nextList = nextMode === 'slides' ? slides : wbPages;
      const nextIndex = nextMode === 'slides' ? slideIndex : wbIndex;
      const target = nextList[nextIndex] || null;
      await loadPageOntoCanvas(target);

      setMode(nextMode);
      setTool('pen');
      setSaveStatus('idle');
      if (target) axios.post(shownEndpoint(nextMode, target.index)).catch(() => {});
    },
    [mode, slides, wbPages, slideIndex, wbIndex, flushSave, loadPageOntoCanvas, shownEndpoint]
  );

  // Mark the first slide shown as soon as a fresh deck loads (teacher is looking at it now).
  useEffect(() => {
    if (hasDeck && mode === 'slides' && slideIndex === 0) {
      axios.post(shownEndpoint('slides', slides[0].index)).catch(() => {});
    }
    // Intentionally keyed only on a fresh upload landing, not on every slides/index change.
  }, [slideDeck?.uploadedAt]);

  // --- Upload (slides) -------------------------------------------------------

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
      setSlideIndex(0);
      if (mode === 'slides') fabricRef.current?.clear();
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Could not process that PDF.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Whiteboard: add a page --------------------------------------------------

  const handleAddPage = async () => {
    if (addingPage || wbPages.length >= MAX_WHITEBOARD_PAGES) return;
    setAddingPage(true);
    try {
      const res = await axios.post(`/meetings/${meetingId}/whiteboard/pages`);
      onWhiteboardChange?.({ pages: res.data.pages });
      const newIndex = res.data.pages.length - 1;
      setWbIndex(newIndex);
      if (mode === 'whiteboard') fabricRef.current?.clear();
      axios.post(shownEndpoint('whiteboard', res.data.pages[newIndex].index)).catch(() => {});
    } catch {
      // Silent — the toolbar's Add page button stays put, teacher can just retry.
    } finally {
      setAddingPage(false);
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
        <div className="smartboard__mode-toggle" role="tablist" aria-label="Smartboard mode" data-tour="smartboard-mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'slides'}
            className={`smartboard__mode-btn${mode === 'slides' ? ' is-active' : ''}`}
            onClick={() => switchMode('slides')}
          >
            <Presentation size={14} strokeWidth={2} aria-hidden />
            Slides
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'whiteboard'}
            className={`smartboard__mode-btn${mode === 'whiteboard' ? ' is-active' : ''}`}
            onClick={() => switchMode('whiteboard')}
          >
            <PenLine size={14} strokeWidth={2} aria-hidden />
            Whiteboard
          </button>
        </div>
        {showsCanvas && (
          <span className="smartboard__save-status" aria-live="polite">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
          </span>
        )}
      </div>

      {mode === 'slides' && !hasDeck && (
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
      )}

      {mode === 'whiteboard' && !hasWbPages && (
        <div className="smartboard__empty">
          <p>Start a blank page to sketch, work through a problem, or take live notes — no slides needed.</p>
          <button type="button" className="smartboard__upload-btn" onClick={handleAddPage} disabled={addingPage || disabled}>
            <Plus size={16} strokeWidth={2} aria-hidden />
            {addingPage ? 'Adding…' : 'Add a whiteboard page'}
          </button>
        </div>
      )}

      {showsCanvas && (
        <>
          <div className="smartboard__toolbar" data-tour="smartboard-tools">
            <div className="smartboard__tool-group">
              <button
                type="button"
                className={`smartboard__tool-btn${tool === 'pen' ? ' is-active' : ''}`}
                onClick={() => setTool('pen')}
                title="Pen"
              >
                <PenLine size={16} strokeWidth={2} aria-hidden /> Pen
              </button>
              <button
                type="button"
                className={`smartboard__tool-btn${tool === 'eraser' ? ' is-active' : ''}`}
                onClick={() => setTool('eraser')}
                title="Eraser — click a stroke to remove it"
              >
                <Eraser size={16} strokeWidth={2} aria-hidden /> Eraser
              </button>
            </div>

            <div className="smartboard__colors" aria-hidden={tool === 'eraser'}>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`smartboard__color-swatch${color === c && tool === 'pen' ? ' is-active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Pen color ${c}`}
                  onClick={() => {
                    setColor(c);
                    setTool('pen');
                  }}
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
              disabled={tool === 'eraser'}
            />

            <div className="smartboard__tool-group">
              <button type="button" className="smartboard__tool-btn" onClick={handleUndo} title="Undo last stroke">
                <Undo2 size={16} strokeWidth={2} aria-hidden /> Undo
              </button>
              <button type="button" className="smartboard__tool-btn" onClick={handleClear} title="Clear this page">
                <Trash2 size={16} strokeWidth={2} aria-hidden /> Clear
              </button>
            </div>
          </div>

          <div className="smartboard__stage" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }} data-tour="smartboard-stage">
            {mode === 'slides' && currentPage && (
              <img className="smartboard__slide-img" src={currentPage.imageUrl} alt={`Slide ${slideIndex + 1}`} />
            )}
            {mode === 'whiteboard' && <div className="smartboard__whiteboard-bg" aria-hidden />}
            <canvas ref={canvasElRef} className="smartboard__canvas" />
          </div>

          <div className="smartboard__nav" data-tour="smartboard-nav">
            <button
              type="button"
              className="smartboard__nav-btn"
              onClick={() => goToPage(currentPageNumber - 2)}
              disabled={currentPageNumber <= 1}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden /> Prev
            </button>
            <span className="smartboard__nav-count">
              {mode === 'slides' ? 'Slide' : 'Page'} {currentPageNumber} of {currentPageTotal}
            </span>
            <button
              type="button"
              className="smartboard__nav-btn"
              onClick={() => goToPage(currentPageNumber)}
              disabled={currentPageNumber >= currentPageTotal}
            >
              Next <ChevronRight size={16} strokeWidth={2} aria-hidden />
            </button>
            {mode === 'slides' ? (
              <label className="smartboard__upload-btn smartboard__upload-btn--compact">
                <Upload size={14} strokeWidth={2} aria-hidden />
                Replace deck
                <input type="file" accept="application/pdf" onChange={handleUpload} disabled={uploading || disabled} hidden />
              </label>
            ) : (
              <button
                type="button"
                className="smartboard__upload-btn smartboard__upload-btn--compact"
                onClick={handleAddPage}
                disabled={addingPage || disabled || wbPages.length >= MAX_WHITEBOARD_PAGES}
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
                {addingPage ? 'Adding…' : 'New page'}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
