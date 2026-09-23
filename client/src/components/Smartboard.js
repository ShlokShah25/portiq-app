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
  MousePointer2,
  Square,
  Circle,
  Minus,
  Type,
  X,
} from 'lucide-react';
import './Smartboard.css';

const PEN_COLORS = ['#111827', '#ef4444', '#f97316', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#ec4899'];
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
 * Tools: Select (move/resize/delete anything already drawn), Pen, Eraser (click a
 * stroke to remove just that one), Rectangle/Ellipse/Line shapes, and Text. Selection
 * + Delete (button or Delete/Backspace key) covers precise corrections; the eraser
 * covers "get rid of that one stroke" without hunting for its selection handles.
 *
 * IMPORTANT lifecycle note: the <canvas> DOM node only exists while `showsCanvas` is
 * true (there's nothing to draw on before a deck/page exists). The Fabric canvas is
 * therefore (re)created whenever `showsCanvas` flips to true, not just once on mount —
 * creating it unconditionally on mount would silently attach to nothing on a lecture
 * that starts with no deck and no whiteboard page yet.
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
  const [tool, setTool] = useState('pen'); // select | pen | eraser | rect | ellipse | line | text
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved
  const [customColorOpen, setCustomColorOpen] = useState(false);

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

  const scheduleSaveRef = useRef(() => {});

  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    if (active.type === 'activeSelection' || active.type === 'active-selection') {
      active.forEachObject((obj) => canvas.remove(obj));
    } else {
      canvas.remove(active);
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    scheduleSaveRef.current();
  }, []);

  // --- Fabric canvas lifecycle ---------------------------------------------------
  // (Re)created whenever the <canvas> element actually exists — see file header.

  useEffect(() => {
    if (!showsCanvas || !canvasElRef.current) return undefined;
    const canvas = new fabric.Canvas(canvasElRef.current, {
      selection: false,
      width: STAGE_W,
      height: STAGE_H,
    });
    fabricRef.current = canvas;

    // This is effectively a fresh mount of the canvas — restore whatever was already
    // saved for the page we're landing on (e.g. reopening a lecture mid-session).
    if (currentPage?.annotations) {
      loadingPageRef.current = true;
      canvas
        .loadFromJSON(currentPage.annotations)
        .then(() => canvas.renderAll())
        .catch(() => canvas.clear())
        .finally(() => {
          loadingPageRef.current = false;
        });
    }

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
    // Intentionally only re-creates on showsCanvas transitions; currentPage is read
    // from the closure at that moment, which is what we want.
  }, [showsCanvas]);

  // Tool/style config — selection only enabled for the Select tool; freehand drawing
  // only for Pen. Other tools (eraser, shapes, text) get their own mouse handlers below.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.isDrawingMode = !disabled && tool === 'pen';
    canvas.selection = !disabled && tool === 'select';
    canvas.skipTargetFind = disabled || tool !== 'select';
    canvas.forEachObject((obj) => {
      obj.selectable = tool === 'select';
      obj.evented = tool === 'select';
    });
    canvas.discardActiveObject();
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = color;
    canvas.freeDrawingBrush.width = brushWidth;
    canvas.defaultCursor = tool === 'select' ? 'default' : tool === 'pen' ? 'crosshair' : 'crosshair';
    canvas.hoverCursor = tool === 'select' ? 'move' : 'crosshair';
    canvas.requestRenderAll();
  }, [tool, color, brushWidth, disabled]);

  // Eraser (click a stroke to remove it) + shape drawing (rect/ellipse/line) + text
  // placement all live in one consolidated pointer handler, keyed on the active tool.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || disabled) return undefined;

    let drawing = null;
    let startX = 0;
    let startY = 0;
    let isDown = false;

    const onMouseDown = (opt) => {
      if (tool === 'eraser') {
        const pointer = canvas.getPointer(opt.e);
        const objects = canvas.getObjects();
        for (let i = objects.length - 1; i >= 0; i -= 1) {
          if (objects[i].containsPoint(pointer)) {
            canvas.remove(objects[i]);
            scheduleSaveRef.current();
            break;
          }
        }
        return;
      }

      if (tool === 'text') {
        const pointer = canvas.getPointer(opt.e);
        const text = new fabric.IText('Text', {
          left: pointer.x,
          top: pointer.y,
          fontSize: Math.max(18, brushWidth * 4),
          fill: color,
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        scheduleSaveRef.current();
        // Switch to Select right away — otherwise every further click on the board
        // while still in Text mode would stamp out another text box instead of
        // letting the teacher click away to finish editing this one.
        setTool('select');
        return;
      }

      if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
        isDown = true;
        const pointer = canvas.getPointer(opt.e);
        startX = pointer.x;
        startY = pointer.y;
        const common = { stroke: color, strokeWidth: brushWidth, fill: 'transparent', selectable: false, evented: false };
        if (tool === 'rect') {
          drawing = new fabric.Rect({ left: startX, top: startY, width: 0, height: 0, ...common });
        } else if (tool === 'ellipse') {
          drawing = new fabric.Ellipse({ left: startX, top: startY, rx: 0, ry: 0, ...common });
        } else {
          drawing = new fabric.Line([startX, startY, startX, startY], {
            stroke: color,
            strokeWidth: brushWidth,
            selectable: false,
            evented: false,
          });
        }
        canvas.add(drawing);
      }
    };

    const onMouseMove = (opt) => {
      if (!isDown || !drawing) return;
      const pointer = canvas.getPointer(opt.e);
      if (tool === 'rect') {
        drawing.set({
          width: Math.abs(pointer.x - startX),
          height: Math.abs(pointer.y - startY),
          left: Math.min(pointer.x, startX),
          top: Math.min(pointer.y, startY),
        });
      } else if (tool === 'ellipse') {
        drawing.set({
          rx: Math.abs(pointer.x - startX) / 2,
          ry: Math.abs(pointer.y - startY) / 2,
          left: Math.min(pointer.x, startX),
          top: Math.min(pointer.y, startY),
        });
      } else if (tool === 'line') {
        drawing.set({ x2: pointer.x, y2: pointer.y });
      }
      canvas.requestRenderAll();
    };

    const onMouseUp = () => {
      if (isDown && drawing) {
        drawing.setCoords();
        scheduleSaveRef.current();
      }
      isDown = false;
      drawing = null;
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    return () => {
      canvas.off('mouse:down', onMouseDown);
      canvas.off('mouse:move', onMouseMove);
      canvas.off('mouse:up', onMouseUp);
    };
  }, [tool, color, brushWidth, disabled]);

  // Delete/Backspace removes the current selection while the Select tool is active.
  // Skipped while a text object is being edited (that key should edit the text, not
  // delete it) and while focus is on a real form field elsewhere on the page.
  useEffect(() => {
    if (tool !== 'select') return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (!active || active.isEditing) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, deleteSelected]);

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
    canvas.on('text:changed', onChange);
    return () => {
      canvas.off('path:created', onChange);
      canvas.off('object:modified', onChange);
      canvas.off('text:changed', onChange);
    };
  }, [scheduleSave, showsCanvas]);

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
      // Only pre-load here if the canvas already exists (target mode already has
      // pages) — if it doesn't, the empty state shows instead and the canvas-creation
      // effect above will load the right page once one gets added.
      if (target && fabricRef.current) await loadPageOntoCanvas(target);

      setMode(nextMode);
      setTool('pen');
      setSaveStatus('idle');
      if (target) axios.post(shownEndpoint(nextMode, target.index)).catch(() => {});
    },
    [mode, slides, wbPages, slideIndex, wbIndex, flushSave, loadPageOntoCanvas, shownEndpoint]
  );

  // Mark the first slide shown as soon as a fresh deck loads (teacher is looking at it now).
  // Also resets the canvas to blank when an existing deck is *replaced* — the canvas
  // creation effect only fires on a showsCanvas false->true transition, which doesn't
  // happen here since hasDeck was already true.
  useEffect(() => {
    if (!hasDeck) return;
    setSlideIndex(0);
    if (fabricRef.current) {
      loadingPageRef.current = true;
      fabricRef.current.clear();
      const first = slides[0];
      if (first?.annotations) {
        fabricRef.current
          .loadFromJSON(first.annotations)
          .then(() => fabricRef.current?.renderAll())
          .catch(() => {})
          .finally(() => {
            loadingPageRef.current = false;
          });
      } else {
        loadingPageRef.current = false;
      }
    }
    axios.post(shownEndpoint('slides', slides[0].index)).catch(() => {});
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
      if (mode === 'whiteboard' && fabricRef.current) fabricRef.current.clear();
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

  const TOOLS = [
    { id: 'select', label: 'Select', Icon: MousePointer2, title: 'Select — move, resize, or delete anything drawn' },
    { id: 'pen', label: 'Pen', Icon: PenLine, title: 'Pen' },
    { id: 'eraser', label: 'Eraser', Icon: Eraser, title: 'Eraser — click a stroke to remove it' },
    { id: 'rect', label: 'Rectangle', Icon: Square, title: 'Rectangle' },
    { id: 'ellipse', label: 'Ellipse', Icon: Circle, title: 'Ellipse' },
    { id: 'line', label: 'Line', Icon: Minus, title: 'Line' },
    { id: 'text', label: 'Text', Icon: Type, title: 'Text — click the board to place it' },
  ];

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
            <div className="smartboard__tool-group smartboard__tool-group--icons">
              {TOOLS.map(({ id, Icon, title }) => (
                <button
                  key={id}
                  type="button"
                  className={`smartboard__icon-btn${tool === id ? ' is-active' : ''}`}
                  onClick={() => setTool(id)}
                  title={title}
                  aria-label={title}
                >
                  <Icon size={17} strokeWidth={2} aria-hidden />
                </button>
              ))}
            </div>

            <div className="smartboard__colors" aria-hidden={tool === 'eraser' || tool === 'select'}>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`smartboard__color-swatch${color === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
              <span className="smartboard__color-custom-wrap">
                <button
                  type="button"
                  className={`smartboard__color-swatch smartboard__color-swatch--custom${customColorOpen ? ' is-active' : ''}`}
                  style={{ background: PEN_COLORS.includes(color) ? undefined : color }}
                  aria-label="Custom color"
                  title="Custom color"
                  onClick={() => setCustomColorOpen((v) => !v)}
                >
                  {PEN_COLORS.includes(color) && <Plus size={12} strokeWidth={2.5} aria-hidden />}
                </button>
                {customColorOpen && (
                  <input
                    type="color"
                    className="smartboard__color-input"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    onBlur={() => setCustomColorOpen(false)}
                    autoFocus
                  />
                )}
              </span>
            </div>

            <input
              type="range"
              min="1"
              max="16"
              value={brushWidth}
              onChange={(e) => setBrushWidth(Number(e.target.value))}
              className="smartboard__width-slider"
              aria-label="Stroke width"
              disabled={tool === 'eraser' || tool === 'select'}
            />

            <div className="smartboard__tool-group">
              <button
                type="button"
                className="smartboard__tool-btn"
                onClick={deleteSelected}
                disabled={tool !== 'select'}
                title="Delete selected"
              >
                <X size={16} strokeWidth={2} aria-hidden /> Delete
              </button>
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
