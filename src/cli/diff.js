/**
 * Terminal diff rendering using @pierre/diffs.
 */

import { parseDiffFromFile } from '@pierre/diffs';

const R = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';

/**
 * Render a file diff to stderr as ANSI-colored terminal output.
 * Returns early and silently if not a TTY or nothing changed.
 *
 * @param {string} path
 * @param {string} before
 * @param {string} after
 */
export function printFileDiff(path, before, after) {
    if (!process.stderr.isTTY) return;
    if (before === after) return;

    let fileMeta;
    try {
        fileMeta = parseDiffFromFile(
            { name: path, contents: before },
            { name: path, contents: after },
            { context: 2 },
        );
    } catch {
        return;
    }

    const { hunks, additionLines, deletionLines } = fileMeta;
    if (!hunks?.length) return;

    const isNew = !before;
    const action = isNew ? 'new file' : 'modified';

    process.stderr.write(`\n  ${BOLD}${CYAN}${path}${R}  ${DIM}${action}${R}\n`);

    for (const hunk of hunks) {
        const header = (hunk.hunkSpecs || '').trim();
        process.stderr.write(`  ${GRAY}${header}${R}\n`);

        for (const seg of hunk.hunkContent) {
            if (seg.type === 'context') {
                for (let i = 0; i < seg.lines; i++) {
                    const line = (additionLines[seg.additionLineIndex + i] ?? '').replace(/\n$/, '');
                    process.stderr.write(`  ${DIM}  ${line}${R}\n`);
                }
            } else {
                for (let i = 0; i < seg.deletions; i++) {
                    const line = (deletionLines[seg.deletionLineIndex + i] ?? '').replace(/\n$/, '');
                    process.stderr.write(`  ${RED}- ${line}${R}\n`);
                }
                for (let i = 0; i < seg.additions; i++) {
                    const line = (additionLines[seg.additionLineIndex + i] ?? '').replace(/\n$/, '');
                    process.stderr.write(`  ${GREEN}+ ${line}${R}\n`);
                }
            }
        }
    }
}
