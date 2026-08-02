/**
 * Persist meeting audio blobs in IndexedDB so End Meeting can retry after
 * network failures or a soft page refresh (same origin / same browser).
 */

const DB_NAME = 'portiq-recording-blobs';
const STORE = 'blobs';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'meetingId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function saveRecordingBlob(meetingId, blob) {
  const id = String(meetingId || '').trim();
  if (!id || !blob) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.objectStore(STORE).put({
        meetingId: id,
        blob,
        mimeType: blob.type || 'audio/webm',
        size: blob.size,
        savedAt: Date.now(),
      });
    });
  } finally {
    db.close();
  }
}

export async function loadRecordingBlob(meetingId) {
  const id = String(meetingId || '').trim();
  if (!id) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const row = req.result;
        if (!row?.blob) {
          resolve(null);
          return;
        }
        resolve(row.blob instanceof Blob ? row.blob : null);
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
}

export async function clearRecordingBlob(meetingId) {
  const id = String(meetingId || '').trim();
  if (!id) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
      tx.objectStore(STORE).delete(id);
    });
  } finally {
    db.close();
  }
}
