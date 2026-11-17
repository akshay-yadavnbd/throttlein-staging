import { getStoredUser } from './auth';

const DATABASE = 'throttlein-product-drafts';
const STORE = 'drafts';
let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Draft storage is blocked'));
    });
  }
  return database;
}

const sessionKey = (sellerId: string) => `tin:product-create:${sellerId}`;

/** A deliberate Add product action starts fresh; reloading the form keeps its current draft. */
export function startNewProductDraft() {
  const sellerId = getStoredUser()?._id;
  if (!sellerId) return;
  const key = sessionStorage.getItem(sessionKey(sellerId));
  if (key) void clearProductCreateDraft(sellerId, key).catch(() => {});
}

export async function loadProductCreateDraft<T>(sellerId: string): Promise<{ key: string; draft: T | null }> {
  let key = sessionStorage.getItem(sessionKey(sellerId));
  if (!key) {
    key = `${sellerId}:${crypto.randomUUID()}`;
    sessionStorage.setItem(sessionKey(sellerId), key);
  }
  const db = await openDatabase();
  const draft = await new Promise<T | null>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => {
      const record = request.result;
      resolve(record?.version === 1 ? record.values as T : null);
    };
    request.onerror = () => reject(request.error);
  });
  return { key, draft };
}

/** IndexedDB keeps staged image Files as well as text; object URLs are rebuilt on restore. */
export async function saveProductCreateDraft<T>(key: string, values: T): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ version: 1, savedAt: Date.now(), values }, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearProductCreateDraft(sellerId: string, key: string): Promise<void> {
  // Retire the session key first, so a failed deletion cannot reopen a saved product as a new draft.
  if (sessionStorage.getItem(sessionKey(sellerId)) === key) sessionStorage.removeItem(sessionKey(sellerId));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error);
  });
}
