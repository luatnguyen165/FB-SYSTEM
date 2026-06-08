// services/pythonScraperWrapper.js
// Wrapper to call Python scraper from Node.js
const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'scripts', 'scraper.py');

/**
 * Run Python scraper with input via stdin, get JSON result via stdout
 * @param {Object} input - { userId, cookies, fbDtsg, limit, proxy }
 * @returns {Promise<Object>} { success, posts, page_name } or { success: false, error }
 */
function runPythonScraper(input) {
    return new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const pythonCmd = isWindows ? 'python' : 'python3';

        console.log(`[Python Wrapper] Starting: ${pythonCmd} ${PYTHON_SCRIPT}`);
        console.log(`[Python Wrapper] Input:`, { userId: input.userId, limit: input.limit, cookiesKeys: Object.keys(input.cookies || {}), fbDtsg: input.fbDtsg ? 'YES' : 'NO', proxy: input.proxy ? 'YES' : 'NO' });

        const proc = spawn(pythonCmd, [PYTHON_SCRIPT], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
        proc.stderr.on('data', chunk => {
            const s = chunk.toString();
            stderr += s;
            // Forward Python logs to Node console
            s.split('\n').forEach(line => {
                if (line.trim()) console.log(`[Python] ${line.trim()}`);
            });
        });

        proc.on('error', err => {
            console.error(`[Python Wrapper] Failed to start:`, err.message);
            reject(err);
        });

        proc.on('close', code => {
            console.log(`[Python Wrapper] Process exited with code ${code}`);
            if (code !== 0 && !stdout) {
                reject(new Error(`Python exited with code ${code}. Stderr: ${stderr}`));
                return;
            }
            try {
                // Find the last JSON line in stdout (skip any warnings)
                const lines = stdout.trim().split('\n');
                let jsonLine = '';
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].trim().startsWith('{')) {
                        jsonLine = lines[i];
                        break;
                    }
                }
                if (!jsonLine) jsonLine = lines[lines.length - 1] || '';
                const result = JSON.parse(jsonLine);
                console.log(`[Python Wrapper] Result: success=${result.success}, posts=${result.posts ? result.posts.length : 0}`);
                resolve(result);
            } catch (e) {
                console.error(`[Python Wrapper] Failed to parse JSON:`, e.message);
                console.error(`[Python Wrapper] stdout:`, stdout.substring(0, 500));
                reject(new Error(`Failed to parse Python output: ${e.message}`));
            }
        });

        // Send input via stdin
        proc.stdin.write(JSON.stringify(input));
        proc.stdin.end();
    });
}

module.exports = { runPythonScraper };
