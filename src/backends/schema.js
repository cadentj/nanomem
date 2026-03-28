/**
 * Memory index generation and bootstrap.
 */

export function buildBootstrapIndex() {
    return `# Memory Index\n\n_No memories yet._\n`;
}

export function createBootstrapRecords(now = Date.now()) {
    return [
        {
            path: '_index.md',
            content: buildBootstrapIndex(),
            l0: 'Root index of memory filesystem',
            parentPath: '',
            createdAt: now,
            updatedAt: now
        }
    ];
}

export function buildMemoryIndex(files) {
    const lines = ['# Memory Index', ''];

    if (files.length > 0) {
        for (const file of files) {
            const count = file.itemCount || 0;
            const updated = file.updatedAt
                ? new Date(file.updatedAt).toISOString().split('T')[0]
                : '';
            const meta = count > 0
                ? `(${count} item${count !== 1 ? 's' : ''}, updated ${updated})`
                : updated ? `(updated ${updated})` : '';
            lines.push(`- ${file.path} ${meta} — ${file.l0}`);
        }
    } else {
        lines.push('_No files yet._');
    }

    return lines.join('\n');
}
