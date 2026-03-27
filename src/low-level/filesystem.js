/**
 * FileSystemStorage — Node.js filesystem storage backend.
 *
 * Stores memory files as .md files on disk. Uses fs/promises (Node 18+).
 */
import { readdir, readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { BaseStorage } from './BaseStorage.js';
import { countMemoryBullets } from '../bullets/index.js';
import { buildMemoryIndex, createBootstrapRecords } from './schema.js';

class FileSystemStorage extends BaseStorage {
    constructor(rootDir) {
        super();
        if (!rootDir) throw new Error('FileSystemStorage requires a rootDir');
        this._root = rootDir;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        await mkdir(this._root, { recursive: true });

        const entries = await this._walkFiles();
        if (entries.length === 0) {
            const seeds = createBootstrapRecords(Date.now());
            for (const seed of seeds) {
                await this._writeRaw(seed.path, seed.content);
            }
        }
    }

    async read(path) {
        await this.init();
        try {
            return await readFile(this._resolve(path), 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    async write(path, content) {
        await this.init();
        const fullPath = this._resolve(path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, String(content || ''), 'utf-8');
        await this.rebuildIndex();
    }

    async delete(path) {
        if (path.endsWith('_index.md')) return;
        await this.init();
        try {
            await unlink(this._resolve(path));
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        await this.rebuildIndex();
    }

    async exists(path) {
        await this.init();
        try {
            await stat(this._resolve(path));
            return true;
        } catch {
            return false;
        }
    }

    async rebuildIndex() {
        await this.init();
        const allFiles = await this._walkFiles();
        const files = allFiles.filter(f => !f.endsWith('_index.md')).sort();
        const fileRecords = [];

        for (const filePath of files) {
            const content = await this.read(filePath);
            let updatedAt = Date.now();
            try {
                const s = await stat(this._resolve(filePath));
                updatedAt = s.mtimeMs;
            } catch { /* skip */ }
            fileRecords.push({
                path: filePath,
                itemCount: countMemoryBullets(content || ''),
                l0: this._generateL0(content || ''),
                updatedAt,
            });
        }

        await this._writeRaw('_index.md', buildMemoryIndex(fileRecords));
    }

    async exportAll() {
        await this.init();
        const allFiles = await this._walkFiles();
        const records = [];

        for (const filePath of allFiles) {
            const content = await this.read(filePath) || '';
            let updatedAt = Date.now();
            try {
                const s = await stat(this._resolve(filePath));
                updatedAt = s.mtimeMs;
            } catch { /* skip */ }
            records.push({
                path: filePath,
                content,
                l0: this._generateL0(content),
                itemCount: countMemoryBullets(content),
                updatedAt,
            });
        }

        return records;
    }

    /** Efficient path listing — avoids reading file content. */
    async _listAllPaths() {
        await this.init();
        return this._walkFiles();
    }

    // ─── Internal helpers ───────────────────────────────────────

    _resolve(path) {
        return join(this._root, path);
    }

    async _writeRaw(path, content) {
        const fullPath = this._resolve(path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, String(content || ''), 'utf-8');
    }

    async _ensureDir(dirPath) {
        await mkdir(join(this._root, dirPath), { recursive: true });
    }

    async _walkFiles(dir = '') {
        const results = [];
        const fullDir = dir ? join(this._root, dir) : this._root;

        let entries;
        try {
            entries = await readdir(fullDir, { withFileTypes: true });
        } catch {
            return results;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const relPath = dir ? `${dir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                results.push(...await this._walkFiles(relPath));
            } else if (entry.name.endsWith('.md')) {
                results.push(relPath);
            }
        }

        return results;
    }
}

export { FileSystemStorage };
