/**
 * Minimal TTY spinner — no dependencies.
 * Writes to stderr so it doesn't pollute stdout piping.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

const c = {
    reset:  '\x1b[0m',
    dim:    '\x1b[2m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
};

/**
 * Create and start a spinner.
 *
 * @param {string} label  Initial label text
 * @returns {{ update: (label: string) => void, stop: (finalLine?: string) => void }}
 */
export function createSpinner(label) {
    if (!process.stderr.isTTY) {
        // Non-TTY: just print the label once, no animation
        process.stderr.write(`  ${label}\n`);
        return {
            update: () => {},
            stop: (finalLine) => { if (finalLine) process.stderr.write(finalLine + '\n'); },
        };
    }

    let current = label;
    let frame = 0;

    function render() {
        const spinner = FRAMES[frame++ % FRAMES.length];
        process.stderr.write(`\r  ${c.cyan}${spinner}${c.reset} ${c.dim}${current}${c.reset}  `);
    }

    render();
    const timer = setInterval(render, INTERVAL_MS);

    return {
        update(newLabel) {
            current = newLabel;
        },
        stop(finalLine) {
            clearInterval(timer);
            process.stderr.write('\r\x1b[2K'); // clear line
            if (finalLine) process.stderr.write(finalLine + '\n');
        },
    };
}
