/**
 * BaseStorage — Abstract storage backend interface.
 *
 * Subclasses must implement:
 *   init()                            → void
 *   _readRaw(path)                    → string|null  (pure I/O, no fact resolution)
 *   _writeRaw(path, content, meta)    → void         (pure I/O, no fact interning)
 *   delete(path)                      → void
 *   exists(path)                      → boolean
 *   rebuildIndex()                    → void         (regenerate _index.md)
 *   exportAll()                       → [{path, content, ...}]
 *
 * BaseStorage provides (NOT abstract — do not override):
 *   read(path)           → _readRaw + fact resolution
 *   write(path, content) → fact interning + _writeRaw + _persistFacts + rebuildIndex
 *
 * BaseStorage also provides default implementations for:
 *   search(query)   → [{path, snippet}]
 *   ls(dirPath)     → {files: string[], dirs: string[]}
 *   getIndex()      → string
 *
 * Fact store:
 *   All bullet lines written via write() are interned into _facts.json:
 *     { "0": "fact text | metadata...", "1": "...", ... }
 *   .md files on disk store references: "- {0}", "- {1}", etc.
 *   read() transparently resolves references back to full text.
 *   Deduplication: facts are keyed by their text before the first "|" pipe,
 *   so the same fact written with updated metadata reuses its existing ID.
 */
import { parseMemoryBullets, extractMemoryTitles, countMemoryBullets } from '../bullets/index.js';

export class BaseStorage {
    constructor() {
        this._facts = new Map();        // id (number) → factText (string)
        this._factsByText = new Map();  // dedupeKey → id
    }

    // ─── Abstract (backends must implement) ─────────────────────

    async init() { throw new Error('BaseStorage.init() not implemented'); }
    async _readRaw(_path) { throw new Error('BaseStorage._readRaw() not implemented'); }
    async _writeRaw(_path, _content, _meta) { throw new Error('BaseStorage._writeRaw() not implemented'); }
    async delete(_path) { throw new Error('BaseStorage.delete() not implemented'); }
    async exists(_path) { throw new Error('BaseStorage.exists() not implemented'); }
    async rebuildIndex() { throw new Error('BaseStorage.rebuildIndex() not implemented'); }
    async exportAll() { throw new Error('BaseStorage.exportAll() not implemented'); }

    // ─── Provided: transparent read/write ───────────────────────

    async read(path) {
        const raw = await this._readRaw(path);
        return raw == null ? null : this._resolveFacts(raw);
    }

    async write(path, content) {
        // Internal files bypass fact interning entirely.
        if (this._isInternalPath(path)) {
            await this._writeRaw(path, String(content || ''), {});
            return;
        }
        const str = String(content || '');
        const meta = {
            l0: this._generateL0(str),
            itemCount: countMemoryBullets(str),
            titles: extractMemoryTitles(str),
        };
        const rawContent = this._internFacts(str);
        await this._writeRaw(path, rawContent, meta);
        await this._persistFacts();
        await this.rebuildIndex();
    }

    // ─── Shared: getIndex, search, ls ───────────────────────────

    async getIndex() {
        return this.read('_index.md');
    }

    async search(query) {
        if (!query?.trim()) return [];
        const lowerQuery = query.toLowerCase();
        const all = await this.exportAll();
        const results = [];

        for (const rec of all) {
            if (this._isInternalPath(rec.path)) continue;
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
            if (this._isInternalPath(filePath)) continue;
            if (prefix && !filePath.startsWith(prefix)) continue;
            const relative = filePath.slice(prefix.length);
            if (!relative.includes('/')) {
                files.push(filePath);
            } else {
                dirSet.add(relative.split('/')[0]);
            }
        }

        return { files, dirs: [...dirSet] };
    }

    // ─── Fact interning ─────────────────────────────────────────

    /** Replace bullet lines with {id} references. Non-bullet lines pass through unchanged. */
    _internFacts(content) {
        return content.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('- ')) return line;
            const bulletText = trimmed.slice(2);
            if (/^\{\d+\}$/.test(bulletText)) return line; // already a reference
            const id = this._internFact(bulletText);
            return `- {${id}}`;
        }).join('\n');
    }

    /** Intern one fact: return existing id (updating stored text) or assign new id. */
    _internFact(bulletText) {
        const key = this._dedupeKey(bulletText);
        if (this._factsByText.has(key)) {
            const id = this._factsByText.get(key);
            this._facts.set(id, bulletText.trim()); // update with latest metadata
            return id;
        }
        const id = this._facts.size;
        this._facts.set(id, bulletText.trim());
        this._factsByText.set(key, id);
        return id;
    }

    /** Dedup key: text before first pipe, lowercased. Ignores metadata changes. */
    _dedupeKey(bulletText) {
        const pipeIdx = bulletText.indexOf('|');
        const text = pipeIdx === -1 ? bulletText : bulletText.slice(0, pipeIdx);
        return text.trim().toLowerCase();
    }

    // ─── Fact resolution ────────────────────────────────────────

    /** Replace {id} references with full fact text. */
    _resolveFacts(content) {
        if (!content || !content.includes('{')) return content;
        return content.replace(/\{(\d+)\}/g, (match, idStr) => {
            const fact = this._facts.get(Number(idStr));
            return fact ?? match;
        });
    }

    // ─── Fact persistence ────────────────────────────────────────

    async _loadFacts() {
        try {
            const raw = await this._readRaw('_facts.json');
            if (!raw) return;
            const obj = JSON.parse(raw);
            for (const [idStr, text] of Object.entries(obj)) {
                const id = Number(idStr);
                this._facts.set(id, text);
                if (text != null) this._factsByText.set(this._dedupeKey(text), id);
            }
        } catch { /* first run — no facts yet */ }
    }

    async _persistFacts() {
        const obj = Object.fromEntries(this._facts);
        await this._writeRaw('_facts.json', JSON.stringify(obj, null, 2), {
            l0: `${this._facts.size} facts`,
            itemCount: this._facts.size,
            titles: [],
        });
    }

    // ─── Shared helpers ──────────────────────────────────────────

    _isInternalPath(path) {
        return path === '_index.md' || path === '_facts.json';
    }

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
