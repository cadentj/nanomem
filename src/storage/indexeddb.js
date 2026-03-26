/**
 * MemoryFileSystem — Virtual markdown filesystem backed by IndexedDB.
 *
 * Browser-only. Stores memory files in a separate 'oa-memory-fs' database.
 */
import { BaseStorage } from './BaseStorage.js';
import { countMemoryBullets, extractMemoryTitles } from '../bullets/index.js';
import { buildMemoryIndex, createBootstrapRecords } from '../schema/memorySchema.js';

const DB_NAME = 'oa-memory-fs';
const DB_VERSION = 1;
const STORE_NAME = 'memoryFiles';

class MemoryFileSystem extends BaseStorage {
    constructor() {
        super();
        this.db = null;
        this._initPromise = null;
    }

    async init() {
        if (this.db) return this.db;
        if (this._initPromise) return this._initPromise;

        this._initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'path' });
                    store.createIndex('parentPath', 'parentPath', { unique: false });
                }
            };

            request.onsuccess = async (event) => {
                this.db = event.target.result;
                try {
                    await this._bootstrap();
                } catch (err) {
                    console.warn('[MemoryFS] Bootstrap error:', err);
                }
                resolve(this.db);
            };

            request.onerror = () => {
                this._initPromise = null;
                reject(request.error);
            };
        });

        return this._initPromise;
    }

    async _bootstrap() {
        const all = await this._getAll();
        if (all.length > 0) return;

        const seeds = createBootstrapRecords(Date.now());
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const seed of seeds) {
                store.put(seed);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async read(path) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(path);
            request.onsuccess = () => resolve(request.result?.content ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    async write(path, content) {
        await this.init();
        const now = Date.now();
        const existing = await this._get(path);
        const nextContent = String(content || '');

        const record = {
            path,
            content: nextContent,
            l0: this._generateL0(nextContent),
            itemCount: countMemoryBullets(nextContent),
            titles: extractMemoryTitles(nextContent),
            parentPath: this._parentPath(path),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        await new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const request = tx.objectStore(STORE_NAME).put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        await this.rebuildIndex();
    }

    async delete(path) {
        if (path.endsWith('_index.md')) return;
        await this.init();

        await new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const request = tx.objectStore(STORE_NAME).delete(path);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
        await this.rebuildIndex();
    }

    async exists(path) {
        await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getKey(path);
            request.onsuccess = () => resolve(request.result !== undefined);
            request.onerror = () => reject(request.error);
        });
    }

    async rebuildIndex() {
        await this.init();
        const all = await this._getAll();
        const files = all
            .filter(r => !r.path.endsWith('_index.md'))
            .sort((a, b) => a.path.localeCompare(b.path));
        const indexContent = buildMemoryIndex(files);
        const existing = await this._get('_index.md');
        const now = Date.now();

        await new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({
                path: '_index.md',
                content: indexContent,
                l0: 'Root index of memory filesystem',
                parentPath: '',
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async exportAll() {
        await this.init();
        return this._getAll();
    }

    // ─── Internal IndexedDB helpers ─────────────────────────────

    async _get(path) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(path);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    async _getAll() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
}

export { MemoryFileSystem };
