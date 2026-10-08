import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import * as fabric from 'fabric';
import {
  Upload,
  Undo2,
  Redo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Presentation,
  PenLine,
  Highlighter,
  Eraser,
  Plus,
  MousePointer2,
  Square,
  Circle,
  Minus,
  Type,
  X,
  Check,
  Loader2,
  HelpCircle,
  Target,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import './Smartboard.css';

const PEN_COLORS = ['#111827', '#ef4444', '#f97316', '#f59e0b', '#16a34a', '#1f6bff', '#7c3aed', '#ec4899'];
// Everything drawn is stored in this fixed 16:9 coordinate space. The canvas on screen can be any
// size (card, fullscreen, a student's phone): it is zoomed to fit, so strokes stay sharp and land
// in the same place everywhere.
const STAGE_W = 1000;
const STAGE_H = 562;
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 3000;
const HISTORY_LIMIT = 60;
const ERASER_TOLERANCE = 10;
const LASER_TTL_MS = 700;
const MAX_WHITEBOARD_PAGES = 30; // mirrors server/routes/smartboard.js MAX_WHITEBOARD_PAGES

const pageKey = (mode, index) => `${mode}:${index}`;

/** Saved drawing for a page as a compact string, or null when the page is blank. */
function serializeAnnotations(annotations) {
  if (!annotations || !Array.isArray(annotations.objects) || annotations.objects.length === 0) return null;
  try {
    return JSON.stringify(annotations);
  } catch {
    return null;
  }
}

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const TOOLS = [
  { id: 'select', Icon: MousePointer2, title: 'Select (V) — move, resize or delete anything drawn' },
  { id: 'pen', Icon: PenLine, title: 'Pen (P)' },
  { id: 'highlighter', Icon: Highlighter, title: 'Highlighter (H)' },
  { id: 'eraser', Icon: Eraser, title: 'Eraser (E) — drag across strokes to remove them' },
  { id: 'rect', Icon: Square, title: 'Rectangle (R)' },
  { id: 'ellipse', Icon: Circle, title: 'Ellipse (O)' },
  { id: 'line', Icon: Minus, title: 'Line (L)' },
  { id: 'text', Icon: Type, title: 'Text (T) — click the board, then type' },
  { id: 'laser', Icon: Target, title: 'Laser pointer (K) — shown live, never saved' },
];

const SHORTCUT_TOOLS = {
  v: 'select',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  t: 'text',
  k: 'laser',
};

const SHORTCUT_HELP = [
  ['V', 'Select'],
  ['P', 'Pen'],
  ['H', 'Highlighter'],
  ['E', 'Eraser'],
  ['R / O / L', 'Rectangle / ellipse / line'],
  ['T', 'Text'],
  ['K', 'Laser pointer'],
  ['← →', 'Previous / next page'],
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z', 'Redo'],
  ['Delete', 'Delete selection'],
  ['F', 'Full screen'],
  ['?', 'This help'],
];

/**
 * Teacher-facing smartboard for a lecture. Two page sources share one drawing surface:
 *  - "slides": an uploaded PDF deck, one image per page, drawn on top of.
 *  - "whiteboard": blank pages.
 * The teacher can switch between them at any point. Which pages were opened and what was drawn
 * on each is what the student recap shows (server/routes/smartboard.js merges both in the order
 * they were used).
 *
 * How drawings are kept safe:
 *  - Every change is copied into an in-memory cache keyed by page, at the moment it happens.
 *    Saving sends that copy for that page, never "whatever is on the canvas right now", so
 *    turning the page or adding one can't save the wrong content or wipe a page.
 *  - Pages and the deck are tracked locally and only grow from what the parent passes in. The
 *    lecture room re-fetches the meeting every few seconds; a slightly old response must not
 *    make a page vanish or roll a drawing back.
 *  - Unsaved pages are retried until they go through, and flushed when the board unmounts or
 *    the tab is hidden.
 *
 * The Fabric canvas element is created by hand inside a host <div> that React never touches.
 * Fabric wraps its canvas in its own container; if React also managed that node, switching
 * between slides and whiteboard made React insert next to a node Fabric had moved, which threw
 * and blanked the whole page.
 */
export default function Smartboard({
  meetingId,
  slideDeck,
  onSlideDeckChange,
  whiteboard,
  onWhiteboardChange,
  disabled,
}) {
  const initialDeck = slideDeck?.slides?.length ? slideDeck : null;
  const initialWbPages = whiteboard?.pages || [];

  const [deck, setDeck] = useState(initialDeck);
  const [deckEpoch, setDeckEpoch] = useState(0);
  const [wbIndexes, setWbIndexes] = useState(() => initialWbPages.map((p) => p.index));
  const [mode, setMode] = useState(() => (!initialDeck && initialWbPages.length ? 'whiteboard' : 'slides'));
  const [slidePos, setSlidePos] = useState(0);
  const [wbPos, setWbPos] = useState(0);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [brushWidth, setBrushWidth] = useState(4);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [addingPage, setAddingPage] = useState(false);
  const [pageError, setPageError] = useState('');
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [laserPoints, setLaserPoints] = useState([]);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [historyUi, setHistoryUi] = useState({ canUndo: false, canRedo: false });
  const [hasSelection, setHasSelection] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);

  const boardRef = useRef(null);
  const stageRef = useRef(null);
  const hostRef = useRef(null);
  const fabricRef = useRef(null);
  const fileInputRef = useRef(null);
  const laserIdRef = useRef(0);
  const mountedRef = useRef(true);

  const deckRef = useRef(initialDeck);
  const cacheRef = useRef(null); // Map<pageKey, string|null> — latest drawing per page, saved or not
  const dirtyRef = useRef(new Set()); // page keys whose latest drawing has not reached the server
  const historyRef = useRef(new Map()); // Map<pageKey, { stack: (string|null)[], pos: number }>
  const currentKeyRef = useRef(null); // page currently on the canvas
  const loadingRef = useRef(false); // true while a page is being painted — ignore canvas events
  const loadTokenRef = useRef(0);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const saveTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const widthRef = useRef(brushWidth);
  const disabledRef = useRef(Boolean(disabled));

  if (cacheRef.current === null) {
    const seed = new Map();
    (initialDeck?.slides || []).forEach((s) => seed.set(pageKey('slides', s.index), serializeAnnotations(s.annotations)));
    initialWbPages.forEach((p) => seed.set(pageKey('whiteboard', p.index), serializeAnnotations(p.annotations)));
    cacheRef.current = seed;
  }

  toolRef.current = tool;
  colorRef.current = color;
  widthRef.current = brushWidth;
  disabledRef.current = Boolean(disabled);

  const slides = deck?.slides || [];
  const hasDeck = slides.length > 0;
  const hasWbPages = wbIndexes.length > 0;
  const showsCanvas = mode === 'slides' ? hasDeck : hasWbPages;
  const safeSlidePos = Math.min(slidePos, Math.max(0, slides.length - 1));
  const safeWbPos = Math.min(wbPos, Math.max(0, wbIndexes.length - 1));
  const currentSlide = hasDeck ? slides[safeSlidePos] : null;
  const currentKey = !showsCanvas
    ? null
    : mode === 'slides'
      ? pageKey('slides', currentSlide.index)
      : pageKey('whiteboard', wbIndexes[safeWbPos]);
  const currentPageNumber = mode === 'slides' ? safeSlidePos + 1 : safeWbPos + 1;
  const currentPageTotal = mode === 'slides' ? slides.length : wbIndexes.length;
  const isFullscreen = nativeFullscreen || pseudoFullscreen;
  const drawStylesDisabled = tool === 'eraser' || tool === 'laser';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Saving -------------------------------------------------------------------

  const saveDirty = useCallback(async () => {
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    if (dirtyRef.current.size === 0) return;
    savingRef.current = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (mountedRef.current) setSaveStatus('saving');
    let failed = false;
    for (const key of Array.from(dirtyRef.current)) {
      const snapshot = cacheRef.current.has(key) ? cacheRef.current.get(key) : null;
      const [pageMode, pageIndex] = key.split(':');
      const url =
        pageMode === 'slides'
          ? `/meetings/${meetingId}/slides/${pageIndex}/annotations`
          : `/meetings/${meetingId}/whiteboard/pages/${pageIndex}/annotations`;
      try {
        await axios.put(url, { annotations: snapshot ? JSON.parse(snapshot) : null });
        // Only clean if nothing changed on that page while the request was in flight.
        const latest = cacheRef.current.has(key) ? cacheRef.current.get(key) : null;
        if (latest === snapshot) dirtyRef.current.delete(key);
      } catch (err) {
        if (err?.response?.status === 404) {
          // The page no longer exists on the server (deck was replaced) — nothing to retry.
          dirtyRef.current.delete(key);
        } else {
          failed = true;
        }
      }
    }
    savingRef.current = false;
    if (failed) {
      if (mountedRef.current) setSaveStatus('error');
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        saveDirty();
      }, SAVE_RETRY_MS);
      return;
    }
    if (dirtyRef.current.size > 0 || saveAgainRef.current) {
      saveAgainRef.current = false;
      saveDirty();
      return;
    }
    if (mountedRef.current) setSaveStatus('saved');
  }, [meetingId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveDirty();
    }, SAVE_DEBOUNCE_MS);
  }, [saveDirty]);

  const flushNow = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveDirty();
  }, [saveDirty]);

  // Flush when the board goes away or the tab is hidden, so the last strokes before
  // "End lecture" (or closing the laptop) are not lost to the debounce.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushNow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushNow);
      flushNow();
    };
  }, [flushNow]);

  // --- History (undo / redo), per page ------------------------------------------

  const historyFor = useCallback((key) => {
    let h = historyRef.current.get(key);
    if (!h) {
      h = { stack: [cacheRef.current.has(key) ? cacheRef.current.get(key) : null], pos: 0 };
      historyRef.current.set(key, h);
    }
    return h;
  }, []);

  const syncHistoryUi = useCallback(() => {
    const key = currentKeyRef.current;
    const h = key ? historyRef.current.get(key) : null;
    const next = { canUndo: Boolean(h && h.pos > 0), canRedo: Boolean(h && h.pos < h.stack.length - 1) };
    setHistoryUi((prev) => (prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next));
  }, []);

  /** Copy what is on the canvas into the cache for the page being shown, and queue a save. */
  const commit = useCallback(() => {
    const canvas = fabricRef.current;
    const key = currentKeyRef.current;
    if (!canvas || !key || loadingRef.current) return;
    const snapshot = serializeAnnotations(canvas.toJSON());
    const previous = cacheRef.current.has(key) ? cacheRef.current.get(key) : null;
    if (snapshot === previous) return;
    const h = historyFor(key);
    h.stack = h.stack.slice(0, h.pos + 1);
    h.stack.push(snapshot);
    if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
    h.pos = h.stack.length - 1;
    cacheRef.current.set(key, snapshot);
    dirtyRef.current.add(key);
    scheduleSave();
    syncHistoryUi();
  }, [historyFor, scheduleSave, syncHistoryUi]);

  // --- Canvas sizing -------------------------------------------------------------

  const fitCanvas = useCallback(() => {
    const canvas = fabricRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const width = Math.round(stage.clientWidth);
    if (!width) return;
    const height = Math.round((width * STAGE_H) / STAGE_W);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.setDimensions({ width, height });
    }
    canvas.setZoom(width / STAGE_W);
    canvas.requestRenderAll();
  }, []);

  /** Put a page's cached drawing on the canvas. */
  const paintPage = useCallback(
    (key) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const token = (loadTokenRef.current += 1);
      loadingRef.current = true;
      const saved = cacheRef.current.has(key) ? cacheRef.current.get(key) : null;
      canvas.discardActiveObject();
      canvas.remove(...canvas.getObjects());
      const finish = () => {
        if (token !== loadTokenRef.current || fabricRef.current !== canvas) return;
        const selectable = toolRef.current === 'select';
        canvas.forEachObject((obj) => {
          obj.selectable = selectable;
          obj.evented = selectable;
        });
        loadingRef.current = false;
        fitCanvas();
      };
      if (!saved) {
        finish();
        return;
      }
      canvas
        .loadFromJSON(saved)
        .then(finish)
        .catch(() => {
          if (token === loadTokenRef.current && fabricRef.current === canvas) canvas.remove(...canvas.getObjects());
          finish();
        });
    },
    [fitCanvas]
  );

  // --- Fabric canvas lifecycle ---------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    const stage = stageRef.current;
    if (!showsCanvas || !host || !stage) return undefined;

    const el = document.createElement('canvas');
    host.appendChild(el);
    const canvas = new fabric.Canvas(el, {
      selection: false,
      preserveObjectStacking: true,
      stopContextMenu: true,
      width: STAGE_W,
      height: STAGE_H,
    });
    canvas.setTargetFindTolerance(ERASER_TOLERANCE);
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.decimate = 2;
    fabricRef.current = canvas;

    let shape = null;
    let shapeStart = null;
    let erasing = false;
    let erasedAny = false;

    const scenePoint = (opt) => opt.scenePoint || canvas.getScenePoint(opt.e);
    const viewportPoint = (opt) => opt.viewportPoint || canvas.getViewportPoint(opt.e);

    const eraseAt = (opt) => {
      const sp = scenePoint(opt);
      const vp = viewportPoint(opt);
      const reach = ERASER_TOLERANCE / (canvas.getZoom() || 1);
      const objects = canvas.getObjects();
      for (let i = objects.length - 1; i >= 0; i -= 1) {
        const obj = objects[i];
        const box = obj.getBoundingRect();
        if (
          sp.x < box.left - reach ||
          sp.x > box.left + box.width + reach ||
          sp.y < box.top - reach ||
          sp.y > box.top + box.height + reach
        ) {
          continue;
        }
        if (!canvas.isTargetTransparent(obj, vp.x, vp.y)) {
          canvas.remove(obj);
          erasedAny = true;
          break;
        }
      }
    };

    const onMouseDown = (opt) => {
      if (disabledRef.current || loadingRef.current) return;
      const activeTool = toolRef.current;

      if (activeTool === 'eraser') {
        erasing = true;
        erasedAny = false;
        eraseAt(opt);
        return;
      }

      if (activeTool === 'text') {
        const p = scenePoint(opt);
        const text = new fabric.IText('', {
          left: p.x,
          top: p.y,
          originX: 'left',
          originY: 'top',
          fontSize: Math.max(22, widthRef.current * 5),
          fill: colorRef.current,
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        // Move to Select so the next click finishes this text box instead of adding another.
        setTool('select');
        return;
      }

      if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line') {
        const p = scenePoint(opt);
        shapeStart = { x: p.x, y: p.y };
        const common = {
          stroke: colorRef.current,
          strokeWidth: widthRef.current,
          fill: 'transparent',
          strokeUniform: true,
          selectable: false,
          evented: false,
        };
        if (activeTool === 'rect') {
          shape = new fabric.Rect({ left: p.x, top: p.y, originX: 'left', originY: 'top', width: 0, height: 0, ...common });
        } else if (activeTool === 'ellipse') {
          shape = new fabric.Ellipse({ left: p.x, top: p.y, originX: 'left', originY: 'top', rx: 0, ry: 0, ...common });
        } else {
          shape = new fabric.Line([p.x, p.y, p.x, p.y], { ...common, strokeLineCap: 'round' });
        }
        shape.__kind = activeTool;
        canvas.add(shape);
      }
    };

    const onMouseMove = (opt) => {
      if (erasing) {
        eraseAt(opt);
        return;
      }
      if (!shape || !shapeStart) return;
      const p = scenePoint(opt);
      if (shape.__kind === 'rect') {
        shape.set({
          left: Math.min(p.x, shapeStart.x),
          top: Math.min(p.y, shapeStart.y),
          width: Math.abs(p.x - shapeStart.x),
          height: Math.abs(p.y - shapeStart.y),
        });
      } else if (shape.__kind === 'ellipse') {
        shape.set({
          left: Math.min(p.x, shapeStart.x),
          top: Math.min(p.y, shapeStart.y),
          rx: Math.abs(p.x - shapeStart.x) / 2,
          ry: Math.abs(p.y - shapeStart.y) / 2,
        });
      } else {
        shape.set({ x2: p.x, y2: p.y });
      }
      canvas.requestRenderAll();
    };

    const onMouseUp = () => {
      if (erasing) {
        erasing = false;
        if (erasedAny) {
          canvas.requestRenderAll();
          commit();
        }
        return;
      }
      if (shape) {
        shape.setCoords();
        const box = shape.getBoundingRect();
        const tooSmall = box.width < 4 && box.height < 4; // a stray click, not a shape
        if (tooSmall) {
          canvas.remove(shape);
        } else {
          commit();
        }
      }
      shape = null;
      shapeStart = null;
    };

    const onPathCreated = (opt) => {
      if (opt?.path) {
        opt.path.selectable = false;
        opt.path.evented = false;
      }
      commit();
    };
    const onTextExit = (opt) => {
      const target = opt?.target;
      if (target && !String(target.text || '').trim()) canvas.remove(target);
      commit();
    };
    const onSelection = () => setHasSelection(Boolean(canvas.getActiveObject()));

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('path:created', onPathCreated);
    canvas.on('object:modified', commit);
    canvas.on('text:changed', commit);
    canvas.on('text:editing:exited', onTextExit);
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);

    fitCanvas();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => fitCanvas());
      observer.observe(stage);
    } else {
      window.addEventListener('resize', fitCanvas);
    }
    setCanvasEpoch((n) => n + 1);

    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', fitCanvas);
      fabricRef.current = null;
      currentKeyRef.current = null;
      loadTokenRef.current += 1;
      loadingRef.current = false;
      setHasSelection(false);
      // dispose() puts the bare <canvas> back in the host; then it is ours to remove.
      canvas.dispose().catch(() => {});
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, [showsCanvas, commit, fitCanvas]);

  // Show the current page whenever the canvas exists and the page (or the deck) changes.
  useEffect(() => {
    if (!canvasEpoch || !currentKey || !fabricRef.current) return;
    currentKeyRef.current = currentKey;
    historyFor(currentKey);
    paintPage(currentKey);
    syncHistoryUi();
    const [pageMode, pageIndex] = currentKey.split(':');
    const url =
      pageMode === 'slides'
        ? `/meetings/${meetingId}/slides/${pageIndex}/shown`
        : `/meetings/${meetingId}/whiteboard/pages/${pageIndex}/shown`;
    // The recap only needs to know this page was opened; never block the board on it.
    axios.post(url).catch(() => {});
  }, [canvasEpoch, currentKey, deckEpoch, meetingId, historyFor, paintPage, syncHistoryUi]);

  // Tool and style. Runs again when a new canvas is created, so the pen works on the very
  // first stroke of a fresh page rather than only after a tool is clicked.
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const isSelect = tool === 'select';
    const isDrawing = !disabled && (tool === 'pen' || tool === 'highlighter');
    canvas.isDrawingMode = isDrawing;
    canvas.selection = !disabled && isSelect;
    canvas.skipTargetFind = Boolean(disabled) || !isSelect;
    canvas.forEachObject((obj) => {
      obj.selectable = isSelect;
      obj.evented = isSelect;
    });
    if (!isSelect) canvas.discardActiveObject();
    const brush = canvas.freeDrawingBrush;
    if (brush) {
      brush.color = tool === 'highlighter' ? withAlpha(color, 0.35) : color;
      brush.width = tool === 'highlighter' ? Math.max(16, brushWidth * 4) : brushWidth;
    }
    const cursor = isSelect ? 'default' : tool === 'laser' ? 'none' : 'crosshair';
    canvas.defaultCursor = cursor;
    canvas.hoverCursor = isSelect ? 'move' : cursor;
    canvas.freeDrawingCursor = 'crosshair';
    canvas.requestRenderAll();
  }, [tool, color, brushWidth, disabled, canvasEpoch]);

  // --- Adopt pages / a deck arriving from the parent (initial load, polling) ------

  const wbSignature = (whiteboard?.pages || []).map((p) => p.index).join(',');
  useEffect(() => {
    const pages = whiteboard?.pages || [];
    if (pages.length === 0) return;
    pages.forEach((p) => {
      const key = pageKey('whiteboard', p.index);
      if (!cacheRef.current.has(key)) cacheRef.current.set(key, serializeAnnotations(p.annotations));
    });
    setWbIndexes((prev) => {
      const merged = Array.from(new Set([...prev, ...pages.map((p) => p.index)])).sort((a, b) => a - b);
      return merged.length === prev.length ? prev : merged;
    });
    // Keyed on which pages exist, not on the array identity (which changes on every poll).
  }, [wbSignature]);

  const adoptDeck = useCallback((nextDeck) => {
    Array.from(cacheRef.current.keys()).forEach((key) => {
      if (key.startsWith('slides:')) {
        cacheRef.current.delete(key);
        dirtyRef.current.delete(key);
        historyRef.current.delete(key);
      }
    });
    (nextDeck?.slides || []).forEach((s) => {
      cacheRef.current.set(pageKey('slides', s.index), serializeAnnotations(s.annotations));
    });
    deckRef.current = nextDeck;
    setDeck(nextDeck);
    setSlidePos(0);
    setDeckEpoch((n) => n + 1);
  }, []);

  const incomingDeckStamp = slideDeck?.slides?.length ? String(slideDeck.uploadedAt || '') : '';
  useEffect(() => {
    if (!incomingDeckStamp) return;
    const current = deckRef.current;
    const currentStamp = current ? String(current.uploadedAt || '') : '';
    if (currentStamp === incomingDeckStamp) return;
    // An older deck here means a poll that started before our own upload finished.
    if (current && new Date(currentStamp).getTime() > new Date(incomingDeckStamp).getTime()) return;
    adoptDeck(slideDeck);
    // Keyed on the deck's upload time only.
  }, [incomingDeckStamp]);

  // Warm the neighbouring slides so turning the page is instant.
  useEffect(() => {
    if (mode !== 'slides' || !hasDeck) return;
    [safeSlidePos - 1, safeSlidePos + 1].forEach((i) => {
      const s = slides[i];
      if (s?.imageUrl) {
        const img = new Image();
        img.src = s.imageUrl;
      }
    });
  }, [mode, hasDeck, safeSlidePos, deckEpoch]);

  // --- Navigation ------------------------------------------------------------------

  /** Close any text box being typed in so its content is committed to the page it is on. */
  const finishEditing = useCallback(() => {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    if (active?.isEditing) active.exitEditing();
    if (canvas) canvas.discardActiveObject();
  }, []);

  const goToPage = useCallback(
    (nextPos) => {
      const total = mode === 'slides' ? slides.length : wbIndexes.length;
      if (nextPos < 0 || nextPos >= total) return;
      finishEditing();
      if (mode === 'slides') setSlidePos(nextPos);
      else setWbPos(nextPos);
    },
    [mode, slides.length, wbIndexes.length, finishEditing]
  );

  const switchMode = useCallback(
    (nextMode) => {
      if (nextMode === mode) return;
      finishEditing();
      setMode(nextMode);
      setTool('pen');
    },
    [mode, finishEditing]
  );

  // --- Upload (slides) -------------------------------------------------------------

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    setUploadError('');
    setUploading(true);
    finishEditing();
    try {
      const fd = new FormData();
      fd.append('deck', file);
      const res = await axios.post(`/meetings/${meetingId}/slides`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 180000,
      });
      const nextDeck = res.data?.slideDeck;
      if (!nextDeck?.slides?.length) throw new Error('No slides came back from the upload.');
      adoptDeck(nextDeck);
      setMode('slides');
      onSlideDeckChange?.(nextDeck);
    } catch (err) {
      setUploadError(
        err.response?.data?.error ||
          (err.code === 'ECONNABORTED'
            ? 'That deck took too long to process. Try a smaller PDF.'
            : 'Could not process that PDF. Export the deck as a PDF and try again.')
      );
    } finally {
      setUploading(false);
      if (input) input.value = '';
    }
  };

  // --- Whiteboard: add a page ------------------------------------------------------

  const handleAddPage = async () => {
    if (addingPage || wbIndexes.length >= MAX_WHITEBOARD_PAGES) return;
    setAddingPage(true);
    setPageError('');
    finishEditing();
    try {
      const res = await axios.post(`/meetings/${meetingId}/whiteboard/pages`);
      const pages = Array.isArray(res.data?.pages) ? res.data.pages : [];
      if (pages.length === 0) throw new Error('No page came back.');
      const merged = Array.from(new Set([...wbIndexes, ...pages.map((p) => p.index)])).sort((a, b) => a - b);
      const newest = Math.max(...pages.map((p) => p.index));
      pages.forEach((p) => {
        const key = pageKey('whiteboard', p.index);
        if (!cacheRef.current.has(key)) cacheRef.current.set(key, null);
      });
      setWbIndexes(merged);
      setWbPos(merged.indexOf(newest));
      setMode('whiteboard');
      onWhiteboardChange?.({ pages });
    } catch (err) {
      setPageError(err.response?.data?.error || 'Could not add a page. Check your connection and try again.');
    } finally {
      setAddingPage(false);
    }
  };

  // --- Toolbar actions -------------------------------------------------------------

  const restoreFromHistory = useCallback(
    (direction) => {
      const key = currentKeyRef.current;
      if (!key || loadingRef.current) return;
      const h = historyFor(key);
      const nextPos = h.pos + direction;
      if (nextPos < 0 || nextPos >= h.stack.length) return;
      finishEditing();
      h.pos = nextPos;
      cacheRef.current.set(key, h.stack[nextPos]);
      dirtyRef.current.add(key);
      scheduleSave();
      paintPage(key);
      syncHistoryUi();
    },
    [historyFor, finishEditing, scheduleSave, paintPage, syncHistoryUi]
  );
  const handleUndo = useCallback(() => restoreFromHistory(-1), [restoreFromHistory]);
  const handleRedo = useCallback(() => restoreFromHistory(1), [restoreFromHistory]);

  const handleClear = () => {
    const canvas = fabricRef.current;
    if (!canvas || canvas.getObjects().length === 0) return;
    canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects());
    canvas.requestRenderAll();
    commit(); // Undo brings it back
  };

  const deleteSelected = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const selected = canvas.getActiveObjects();
    if (!selected.length) return;
    canvas.discardActiveObject();
    selected.forEach((obj) => canvas.remove(obj));
    canvas.requestRenderAll();
    commit();
  }, [commit]);

  const pickColor = (next) => {
    setColor(next);
    const canvas = fabricRef.current;
    if (tool !== 'select' || !canvas) return;
    const selected = canvas.getActiveObjects();
    if (!selected.length) return;
    selected.forEach((obj) => {
      if (obj.isType?.('i-text', 'text', 'textbox') || typeof obj.text === 'string') obj.set('fill', next);
      else obj.set('stroke', next);
    });
    canvas.requestRenderAll();
    commit();
  };

  // --- Full screen -----------------------------------------------------------------

  useEffect(() => {
    const onChange = () => setNativeFullscreen(Boolean(boardRef.current) && document.fullscreenElement === boardRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = boardRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* already left */
      }
      return;
    }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    try {
      if (!el.requestFullscreen) throw new Error('unsupported');
      await el.requestFullscreen();
    } catch {
      // Some tablets and embedded browsers refuse element full screen — fill the window instead.
      setPseudoFullscreen(true);
    }
  }, [pseudoFullscreen]);

  // --- Laser pointer (DOM only, never part of the saved drawing) --------------------

  const handleStageMouseMove = useCallback(
    (e) => {
      if (tool !== 'laser' || disabled) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const now = Date.now();
      laserIdRef.current += 1;
      setLaserPoints((prev) => [
        ...prev.filter((p) => now - p.at < LASER_TTL_MS),
        { id: laserIdRef.current, x, y, at: now },
      ]);
    },
    [tool, disabled]
  );

  const handleStageMouseLeave = useCallback(() => {
    if (tool === 'laser') setLaserPoints([]);
  }, [tool]);

  useEffect(() => {
    if (tool !== 'laser') setLaserPoints([]);
  }, [tool]);

  // --- Keyboard --------------------------------------------------------------------

  useEffect(() => {
    if (disabled) return undefined;
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Fabric edits text through a hidden <textarea>; that is not a "real" form field.
        const editingOnCanvas = Boolean(fabricRef.current?.getActiveObject()?.isEditing);
        if (!editingOnCanvas) return;
      }
      const canvas = fabricRef.current;
      const active = canvas?.getActiveObject();
      if (active?.isEditing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          finishEditing();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (shortcutsOpen) setShortcutsOpen(false);
        else if (pseudoFullscreen) setPseudoFullscreen(false);
        return;
      }
      if (!showsCanvas) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if (key === 'y') {
          e.preventDefault();
          handleRedo();
        }
        return;
      }
      if (e.altKey) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tool === 'select' && active) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(currentPageNumber);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(currentPageNumber - 2);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (SHORTCUT_TOOLS[key]) {
        e.preventDefault();
        setTool(SHORTCUT_TOOLS[key]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    disabled,
    showsCanvas,
    tool,
    shortcutsOpen,
    pseudoFullscreen,
    currentPageNumber,
    goToPage,
    handleUndo,
    handleRedo,
    deleteSelected,
    finishEditing,
    toggleFullscreen,
  ]);

  // --- Render ----------------------------------------------------------------------

  const saveLabel =
    saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved — retrying' : 'Saved';

  return (
    <section
      ref={boardRef}
      className={`smartboard${isFullscreen ? ' is-fullscreen' : ''}${pseudoFullscreen ? ' is-pseudo-fullscreen' : ''}`}
      aria-label="Smartboard"
    >
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
        <div className="smartboard__head-actions">
          {showsCanvas && saveStatus !== 'idle' && (
            <span className={`smartboard__save-status is-${saveStatus}`} aria-live="polite">
              {saveStatus === 'saved' ? (
                <Check size={13} strokeWidth={3} className="smartboard__save-status-check" aria-hidden />
              ) : (
                <Loader2 size={13} strokeWidth={2.5} className="smartboard__spin" aria-hidden />
              )}
              {saveLabel}
            </span>
          )}
          {showsCanvas && (
            <button
              type="button"
              className="smartboard__tool-btn smartboard__fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen (F) — for the projector or smart board'}
            >
              {isFullscreen ? (
                <Minimize2 size={15} strokeWidth={2} aria-hidden />
              ) : (
                <Maximize2 size={15} strokeWidth={2} aria-hidden />
              )}
              {isFullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
          )}
        </div>
      </div>

      {mode === 'slides' && !hasDeck && (
        <div className="smartboard__empty">
          <p>Upload this lecture's slides as a PDF to draw on them live. Students get only the slides you open, with your notes on them.</p>
          <label className={`smartboard__upload-btn${uploading ? ' is-busy' : ''}`}>
            {uploading ? (
              <Loader2 size={16} strokeWidth={2.5} className="smartboard__spin" aria-hidden />
            ) : (
              <Upload size={16} strokeWidth={2} aria-hidden />
            )}
            {uploading ? 'Preparing your slides…' : 'Upload slide deck (PDF)'}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleUpload}
              disabled={uploading || disabled}
              hidden
            />
          </label>
          <p className="smartboard__hint">In PowerPoint or Google Slides: File → Export / Download → PDF.</p>
          {uploadError && <p className="smartboard__error">{uploadError}</p>}
        </div>
      )}

      {mode === 'whiteboard' && !hasWbPages && (
        <div className="smartboard__empty">
          <p>Start a blank page to sketch, work through a problem or take live notes. No slides needed.</p>
          <button type="button" className="smartboard__upload-btn" onClick={handleAddPage} disabled={addingPage || disabled}>
            <Plus size={16} strokeWidth={2} aria-hidden />
            {addingPage ? 'Adding…' : 'Add a whiteboard page'}
          </button>
          {pageError && <p className="smartboard__error">{pageError}</p>}
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
                  aria-pressed={tool === id}
                  data-tool={id}
                >
                  <Icon size={17} strokeWidth={2} aria-hidden />
                </button>
              ))}
            </div>

            <div className="smartboard__colors" aria-hidden={drawStylesDisabled}>
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`smartboard__color-swatch${color === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => pickColor(c)}
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
                    onChange={(e) => pickColor(e.target.value)}
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
              title="Stroke width"
              disabled={drawStylesDisabled || tool === 'select'}
            />

            <div className="smartboard__tool-group smartboard__tool-group--actions">
              <button
                type="button"
                className="smartboard__icon-btn"
                onClick={handleUndo}
                disabled={!historyUi.canUndo}
                title="Undo (Ctrl/⌘ + Z)"
                aria-label="Undo"
                data-action="undo"
              >
                <Undo2 size={17} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="smartboard__icon-btn"
                onClick={handleRedo}
                disabled={!historyUi.canRedo}
                title="Redo (Ctrl/⌘ + Shift + Z)"
                aria-label="Redo"
                data-action="redo"
              >
                <Redo2 size={17} strokeWidth={2} aria-hidden />
              </button>
              {/* Always rendered so the toolbar never changes size (and the board never jumps)
                  when the Select tool is picked. */}
              <button
                type="button"
                className="smartboard__icon-btn"
                onClick={deleteSelected}
                disabled={tool !== 'select' || !hasSelection}
                title="Delete selected (Delete) — pick the Select tool and click what you want to remove"
                aria-label="Delete selected"
                data-action="delete"
              >
                <X size={17} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="smartboard__icon-btn"
                onClick={handleClear}
                title="Clear this page (Undo brings it back)"
                aria-label="Clear this page"
                data-action="clear"
              >
                <Trash2 size={17} strokeWidth={2} aria-hidden />
              </button>
              <button
                type="button"
                className="smartboard__icon-btn"
                onClick={() => setShortcutsOpen(true)}
                title="Keyboard shortcuts (?)"
                aria-label="Keyboard shortcuts"
              >
                <HelpCircle size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>

          <div className="smartboard__stage-wrap">
            <div
              className="smartboard__stage"
              ref={stageRef}
              style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
              data-tour="smartboard-stage"
              data-mode={mode}
              onMouseMove={handleStageMouseMove}
              onMouseLeave={handleStageMouseLeave}
            >
              {mode === 'slides' && currentSlide && (
                <img
                  className="smartboard__slide-img"
                  src={currentSlide.imageUrl}
                  alt={`Slide ${safeSlidePos + 1}`}
                  draggable={false}
                />
              )}
              {mode === 'whiteboard' && <div className="smartboard__whiteboard-bg" aria-hidden />}
              <div ref={hostRef} className="smartboard__canvas-host" />
              {tool === 'laser' && laserPoints.length > 0 && (
                <div className="smartboard__laser-layer" aria-hidden>
                  {laserPoints.map((p) => (
                    <span key={p.id} className="smartboard__laser-dot" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="smartboard__nav" data-tour="smartboard-nav">
            <button
              type="button"
              className="smartboard__nav-btn"
              onClick={() => goToPage(currentPageNumber - 2)}
              disabled={currentPageNumber <= 1}
              data-nav="prev"
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
              data-nav="next"
            >
              Next <ChevronRight size={16} strokeWidth={2} aria-hidden />
            </button>
            {mode === 'slides' ? (
              <label className="smartboard__upload-btn smartboard__upload-btn--compact">
                {uploading ? (
                  <Loader2 size={14} strokeWidth={2.5} className="smartboard__spin" aria-hidden />
                ) : (
                  <Upload size={14} strokeWidth={2} aria-hidden />
                )}
                {uploading ? 'Preparing…' : 'Replace deck'}
                <input type="file" accept="application/pdf,.pdf" onChange={handleUpload} disabled={uploading || disabled} hidden />
              </label>
            ) : (
              <button
                type="button"
                className="smartboard__upload-btn smartboard__upload-btn--compact"
                onClick={handleAddPage}
                disabled={addingPage || disabled || wbIndexes.length >= MAX_WHITEBOARD_PAGES}
                data-nav="new-page"
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
                {addingPage ? 'Adding…' : 'New page'}
              </button>
            )}
          </div>
          {(uploadError || pageError) && <p className="smartboard__error smartboard__error--center">{uploadError || pageError}</p>}
        </>
      )}

      {shortcutsOpen && (
        <div className="smartboard__shortcuts-backdrop" onClick={() => setShortcutsOpen(false)}>
          <div className="smartboard__shortcuts-card" onClick={(e) => e.stopPropagation()}>
            <div className="smartboard__shortcuts-head">
              <h3>Keyboard shortcuts</h3>
              <button type="button" className="smartboard__icon-btn" onClick={() => setShortcutsOpen(false)} aria-label="Close">
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <ul className="smartboard__shortcuts-list">
              {SHORTCUT_HELP.map(([key, label]) => (
                <li key={key}>
                  <kbd>{key}</kbd>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
