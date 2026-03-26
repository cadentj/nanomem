/**
 * BaseStorage — Abstract storage backend interface.
 *
 * Subclasses must implement:
 *   init()                → void        (initialize backend, bootstrap if empty)
 *   read(path)            → string|null (read file content)
 *   write(path, content)  → void        (write file, rebuild index)
 *   delete(path)          → void        (delete file, rebuild index)
 *   exists(path)          → boolean
 *   rebuildIndex()        → void        (regenerate _index.md)
 *   exportAll()           → [{path, content, updatedAt, itemCount, l0}]
 *
 * Base class provides default implementations for:
 *   search(query)         → [{path, snippet}]
 *   ls(dirPath)           → {files: string[], dirs: string[]}
 *   getIndex()            → string
 *
 * Override _listAllPaths() for more efficient ls() in your backend.
 */
import { parseMemoryBullets, extractMemoryTitles } from '../bullets/index.js';

export class BaseStorage {

    // ─── Abstract (must override) ───────────────────────────────

    async init() { throw new Error('BaseStorage.init() not implemented'); }
    async read(_path) { throw new Error('BaseStorage.read() not implemented'); }
    async write(_path, _content) { throw new Error('BaseStorage.write() not implemented'); }
    async delete(_path) { throw new Error('BaseStorage.delete() not implemented'); }
    async exists(_path) { throw new Error('BaseStorage.exists() not implemented'); }
    async rebuildIndex() { throw new Error('BaseStorage.rebuildIndex() not implemented'); }
    async exportAll() { throw new Error('BaseStorage.exportAll() not implemented'); }

    // ─── Shared implementations ─────────────────────────────────

    async getIndex() {
        return this.read('_index.md');
    }

    async search(query) {
        if (!query?.trim()) return [];
        const lowerQuery = query.toLowerCase();
        const all = await this.exportAll();
        const results = [];

        for (const rec of all) {
            if (rec.path.endsWith('_index.md')) continue;
            const content = rec.content || '';
            const idx = content.toLowerCase().indexOf(lowerQuery);
            if (idx === -1) continue;
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + query.length + 40);
            results.push({
                path: rec.path,
                snippet: (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : ''),
            });
        }

        return results;
    }

    async ls(dirPath) {
        const allPaths = await this._listAllPaths();
        const prefix = dirPath ? dirPath + '/' : '';
        const files = [];
        const dirSet = new Set();

        for (const filePath of allPaths) {
            if (prefix && !filePath.startsWith(prefix)) continue;
            if (!prefix && filePath === '_index.md') continue;
            const relative = filePath.slice(prefix.length);
            if (!relative.includes('/')) {
                files.push(filePath);
            } else {
                dirSet.add(relative.split('/')[0]);
            }
        }

        return { files, dirs: [...dirSet] };
    }

    // ─── Shared helpers (used by subclasses) ────────────────────

    /** Override for efficient path listing. Default uses exportAll(). */
    async _listAllPaths() {
        const all = await this.exportAll();
        return all.map(r => r.path);
    }

    _parentPath(filePath) {
        const lastSlash = filePath.lastIndexOf('/');
        return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
    }

    /** Generate a one-line summary of file content for the index. */
    _generateL0(content) {
        if (!content) return '';

        const bullets = parseMemoryBullets(content);
        if (bullets.length > 0) {
            const factTexts = bullets
                .filter(b => b.section !== 'archive')
                .slice(0, 4)
                .map(b => b.text.trim())
                .filter(Boolean);
            if (factTexts.length > 0) {
                const joined = factTexts.join('; ');
                return joined.length > 120 ? joined.slice(0, 117) + '...' : joined;
            }
        }

        const titles = extractMemoryTitles(content);
        if (titles.length > 0) {
            const joined = titles.join('; ');
            return joined.length > 120 ? joined.slice(0, 117) + '...' : joined;
        }

        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            return trimmed.length > 120 ? trimmed.slice(0, 117) + '...' : trimmed;
        }
        return content.slice(0, 120);
    }
}
