/**
 * FileSystemStorage — Node.js filesystem storage backend.
 *
 * Stores memory files as actual .md files on disk.
 * Uses fs/promises (Node 18+).
 */

import { readdir, readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import {
    countMemoryBullets,
    extractMemoryTitles,
    parseMemoryBullets,
} from '../bullets/utils.js';

const BOOTSTRAP_INDEX = `# Memory Index

## Structure
- personal/ — User background, preferences, interests, career
- projects/ — One file per project (e.g. projects/recipe-app.md)

_No memories yet._
`;

class FileSystemStorage {
    constructor(rootDir) {
        if (!rootDir) throw new Error('FileSystemStorage requires a rootDir');
        this._root = rootDir;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        // Create root dir if needed
        await mkdir(this._root, { recursive: true });

        // Bootstrap seed files if empty
        const entries = await this._walkFiles();
        if (entries.length === 0) {
            await this._writeRaw('_index.md', BOOTSTRAP_INDEX);
            await this._ensureDir('personal');
            await this._writeRaw('personal/about.md', '');
            await this._ensureDir('projects');
            await this._writeRaw('projects/about.md', '');
        }
    }

    async read(path) {
        await this.init();
        try {
            const content = await readFile(this._resolve(path), 'utf-8');
            return content;
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

        // Rebuild index (non-blocking)
        this.rebuildIndex().catch(() => {});
    }

    async delete(path) {
        if (path.endsWith('_index.md')) return;
        await this.init();
        try {
            await unlink(this._resolve(path));
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
        this.rebuildIndex().catch(() => {});
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

    async ls(dirPath) {
        await this.init();
        const allFiles = await this._walkFiles();
        const prefix = dirPath ? dirPath + '/' : '';
        const files = [];
        const dirSet = new Set();

        for (const filePath of allFiles) {
            if (prefix && !filePath.startsWith(prefix)) continue;
            if (!prefix && filePath === '_index.md') continue;

            const rel = filePath.slice(prefix.length);
            if (!rel.includes('/')) {
                files.push(filePath);
            } else {
                dirSet.add(rel.split('/')[0]);
            }
        }

        return { files, dirs: [...dirSet] };
    }

    async search(query) {
        await this.init();
        if (!query || !query.trim()) return [];
        const lowerQuery = query.toLowerCase();
        const allFiles = await this._walkFiles();
        const results = [];

        for (const filePath of allFiles) {
            if (filePath.endsWith('_index.md')) continue;
            const content = await this.read(filePath);
            if (!content) continue;
            const idx = content.toLowerCase().indexOf(lowerQuery);
            if (idx === -1) continue;
            const start = Math.max(0, idx - 40);
            const end = Math.min(content.length, idx + query.length + 40);
            results.push({
                path: filePath,
                snippet: (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : ''),
            });
        }

        return results;
    }

    async getIndex() {
        return this.read('_index.md');
    }

    async rebuildIndex() {
        await this.init();
        const allFiles = await this._walkFiles();
        const files = allFiles
            .filter(f => !f.endsWith('_index.md'))
            .sort();

        let indexContent = '# Memory Index\n\n';
        indexContent += '## Structure\n';
        indexContent += '- personal/ — User background, preferences, interests, career\n';
        indexContent += '- projects/ — One file per project (e.g. projects/recipe-app.md)\n\n';

        if (files.length > 0) {
            indexContent += '## Files\n';
            for (const filePath of files) {
                const content = await this.read(filePath);
                const count = countMemoryBullets(content || '');
                const l0 = this._generateL0(content || '');
                let updated = '';
                try {
                    const s = await stat(this._resolve(filePath));
                    updated = new Date(s.mtimeMs).toISOString().split('T')[0];
                } catch { /* skip */ }
                const meta = count > 0
                    ? `(${count} item${count !== 1 ? 's' : ''}, updated ${updated})`
                    : updated ? `(updated ${updated})` : '';
                indexContent += `- ${filePath} ${meta} — ${l0}\n`;
            }
        } else {
            indexContent += '_No files yet._\n';
        }

        await this._writeRaw('_index.md', indexContent);
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

    // ─── Internal Helpers ────────────────────────────────────────

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
                const sub = await this._walkFiles(relPath);
                results.push(...sub);
            } else if (entry.name.endsWith('.md')) {
                results.push(relPath);
            }
        }

        return results;
    }

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

export { FileSystemStorage };
