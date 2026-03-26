/**
 * InMemoryStorage — In-memory (RAM) storage backend for testing.
 *
 * Data is lost when the process exits.
 */
import { BaseStorage } from './BaseStorage.js';
import { countMemoryBullets, extractMemoryTitles } from '../bullets/index.js';
import { buildMemoryIndex, createBootstrapRecords } from '../schema/memorySchema.js';

class InMemoryStorage extends BaseStorage {
    constructor() {
        super();
        this._files = new Map();
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        this._initialized = true;
        if (this._files.size > 0) return;

        const seeds = createBootstrapRecords(Date.now());
        for (const seed of seeds) {
            this._files.set(seed.path, seed);
        }
    }

    async read(path) {
        await this.init();
        const record = this._files.get(path);
        return record?.content ?? null;
    }

    async write(path, content) {
        await this.init();
        const now = Date.now();
        const existing = this._files.get(path);
        const nextContent = String(content || '');

        this._files.set(path, {
            path,
            content: nextContent,
            l0: this._generateL0(nextContent),
            itemCount: countMemoryBullets(nextContent),
            titles: extractMemoryTitles(nextContent),
            parentPath: this._parentPath(path),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });

        await this.rebuildIndex();
    }

    async delete(path) {
        if (path.endsWith('_index.md')) return;
        await this.init();
        this._files.delete(path);
        await this.rebuildIndex();
    }

    async exists(path) {
        await this.init();
        return this._files.has(path);
    }

    async rebuildIndex() {
        await this.init();
        const files = [...this._files.values()]
            .filter(r => !r.path.endsWith('_index.md'))
            .sort((a, b) => a.path.localeCompare(b.path));
        const indexContent = buildMemoryIndex(files);
        const existing = this._files.get('_index.md');
        const now = Date.now();

        this._files.set('_index.md', {
            path: '_index.md',
            content: indexContent,
            l0: 'Root index of memory filesystem',
            parentPath: '',
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }

    async exportAll() {
        await this.init();
        return [...this._files.values()];
    }

    async _listAllPaths() {
        await this.init();
        return [...this._files.keys()];
    }
}

export { InMemoryStorage };
