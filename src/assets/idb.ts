/**
 * Storage for uploaded files: the original bytes plus the definitions derived
 * from them, in IndexedDB (so uploads survive a reload) or, when that is not
 * available, in memory for the session.
 *
 * Records (small, JSON) and blobs (large) live in separate object stores, so
 * listing the uploads never reads file contents into memory.
 */
import type { CharacterDef, DanceDef, SongDef } from '../types';

/** One uploaded file and what it provides. */
export interface UploadRecord {
  /** Short unique id of the file; its definitions have ids starting with `upload:<id>`. */
  id: string;
  /** Original file name. */
  name: string;
  /** Bytes. */
  size: number;
  /** MIME type as reported by the browser ('' when unknown). */
  type: string;
  /** Epoch milliseconds. */
  addedAt: number;
  characters: CharacterDef[];
  dances: DanceDef[];
  songs: SongDef[];
}

/** Where uploads are kept. */
export interface UploadStore {
  /** False for the in-memory fallback: uploads are gone after a reload. */
  readonly persistent: boolean;
  /** All records, oldest first. Never touches file contents. */
  list(): Promise<UploadRecord[]>;
  /** Adds a record with its bytes (null when the definitions carry everything, as for JSON files). */
  put(record: UploadRecord, blob: Blob | null): Promise<void>;
  /** Replaces a record, keeping its bytes. */
  update(record: UploadRecord): Promise<void>;
  /** The stored bytes of a file. */
  getBlob(id: string): Promise<Blob | undefined>;
  /** Deletes a record and its bytes. */
  delete(id: string): Promise<void>;
}

/** Session-only store. */
export function createMemoryUploadStore(): UploadStore {
  const records = new Map<string, UploadRecord>();
  const blobs = new Map<string, Blob>();
  return {
    persistent: false,
    async list() {
      return [...records.values()].sort((a, b) => a.addedAt - b.addedAt);
    },
    async put(record, blob) {
      records.set(record.id, record);
      if (blob) blobs.set(record.id, blob);
    },
    async update(record) {
      if (records.has(record.id)) records.set(record.id, record);
    },
    async getBlob(id) {
      return blobs.get(id);
    },
    async delete(id) {
      records.delete(id);
      blobs.delete(id);
    },
  };
}

const RECORDS = 'records';
const BLOBS = 'blobs';

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted'));
  });
}

/**
 * Opens the IndexedDB-backed store. Resolves to null when IndexedDB is
 * missing or refuses to open (private windows, blocked site data), so the
 * caller can fall back to createMemoryUploadStore().
 */
export async function openIdbUploadStore(name = 'thunes-uploads'): Promise<UploadStore | null> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return null;
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        if (!upgrading.objectStoreNames.contains(RECORDS)) upgrading.createObjectStore(RECORDS, { keyPath: 'id' });
        if (!upgrading.objectStoreNames.contains(BLOBS)) upgrading.createObjectStore(BLOBS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
  } catch {
    return null;
  }
  // Another tab upgrading the database must not be blocked by this one.
  db.onversionchange = () => db.close();

  return {
    persistent: true,
    async list() {
      const records = await requestDone(db.transaction(RECORDS, 'readonly').objectStore(RECORDS).getAll() as IDBRequest<UploadRecord[]>);
      return records.sort((a, b) => a.addedAt - b.addedAt);
    },
    async put(record, blob) {
      const transaction = db.transaction([RECORDS, BLOBS], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(RECORDS).put(record);
      if (blob) transaction.objectStore(BLOBS).put(blob, record.id);
      await done;
    },
    async update(record) {
      const transaction = db.transaction(RECORDS, 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(RECORDS).put(record);
      await done;
    },
    async getBlob(id) {
      const blob = await requestDone(db.transaction(BLOBS, 'readonly').objectStore(BLOBS).get(id) as IDBRequest<Blob | undefined>);
      return blob ?? undefined;
    },
    async delete(id) {
      const transaction = db.transaction([RECORDS, BLOBS], 'readwrite');
      const done = transactionDone(transaction);
      transaction.objectStore(RECORDS).delete(id);
      transaction.objectStore(BLOBS).delete(id);
      await done;
    },
  };
}
