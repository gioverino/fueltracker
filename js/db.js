const DB_NAME = 'FuelTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'fuelups';
const LS_KEY = 'fuel_tracker_backup';
const LS_LAST_EXPORT = 'fuel_tracker_last_export';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/** Save a mirror of all data to localStorage as redundancy */
function mirrorToLocalStorage(fuelups) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(fuelups));
  } catch (e) {
    // localStorage full or unavailable — silent fail
  }
}

/** Get mirrored data from localStorage */
function getFromLocalStorage() {
  try {
    const data = localStorage.getItem(LS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

async function addFuelup(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(entry);
    request.onsuccess = async () => {
      // Mirror all data to localStorage after each add
      const all = await getAllFuelups();
      mirrorToLocalStorage(all);
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAllFuelups() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.index('date').getAll();
    request.onsuccess = () => {
      const results = request.result;
      // If IndexedDB is empty but localStorage has data — auto-recover
      if (results.length === 0) {
        const backup = getFromLocalStorage();
        if (backup.length > 0) {
          recoverFromLocalStorage(backup).then(() => {
            // Re-read after recovery
            const tx2 = db.transaction(STORE_NAME, 'readonly');
            const store2 = tx2.objectStore(STORE_NAME);
            const req2 = store2.index('date').getAll();
            req2.onsuccess = () => resolve(req2.result);
            req2.onerror = () => resolve(backup);
          });
          return;
        }
      }
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deleteFuelup(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = async () => {
      // Update localStorage mirror
      const all = await getAllFuelups();
      mirrorToLocalStorage(all);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/** Recover data from localStorage into IndexedDB */
async function recoverFromLocalStorage(backup) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  for (const entry of backup) {
    const { id, ...data } = entry;
    store.add(data);
  }
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Get days since last file export */
function getDaysSinceLastExport() {
  const last = localStorage.getItem(LS_LAST_EXPORT);
  if (!last) return null;
  const diff = Date.now() - new Date(last).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/** Mark export as done */
function markExportDone() {
  localStorage.setItem(LS_LAST_EXPORT, new Date().toISOString());
}

export { addFuelup, getAllFuelups, deleteFuelup, getDaysSinceLastExport, markExportDone };
