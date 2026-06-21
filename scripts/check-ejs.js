const fs = require('fs');
const content = fs.readFileSync('c:/Users/nluat/Desktop/FB-SYSTEM/views/partials/pagination.ejs', 'utf8');
const lines = content.split('\n');
let i = 0;
let lineNum = 1;
let col = 0;
const len = content.length;

function isExprStart(idx) {
    return content[idx] === '<' && content[idx+1] === '%' &&
           (content[idx+2] === '=' || content[idx+2] === '-');
}

function isScriptletStart(idx) {
    return content[idx] === '<' && content[idx+1] === '%' &&
           content[idx+2] !== '=' && content[idx+2] !== '-' && content[idx+2] !== '%';
}

while (i < len) {
    if (isScriptletStart(i)) {
        const startLine = lineNum;
        const startCol = col;
        let end = i + 2;
        let depth = 0;
        let inStr = null;
        let localLine = lineNum;
        let localCol = col + 2;

        while (end < len) {
            const ch = content[end];
            const next = content[end + 1];

            if (ch === '\n') { localLine++; localCol = 0; } else localCol++;

            if (inStr) {
                if (ch === '\\' && end + 1 < len) { end += 2; localCol++; continue; }
                if (ch === inStr) inStr = null;
            } else {
                if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
                else if (ch === '{') depth++;
                else if (ch === '}') depth--;
                else if (ch === '%' && next === '>' && depth === 0) {
                    end += 2;
                    break;
                }
            }
            end++;
        }

        if (end >= len) {
            console.log('UNCLOSED scriptlet at line', startLine, 'col', startCol);
            console.log('--- context ---');
            for (let l = Math.max(0, startLine - 5); l < Math.min(lines.length, startLine + 2); l++) {
                const marker = (l + 1 === startLine) ? '>>' : '  ';
                console.log(marker, (l + 1) + ': ' + lines[l]);
            }
            process.exit(1);
        }

        i = end;
        lineNum = localLine;
        col = localCol;
        continue;
    }

    if (isExprStart(i)) {
        const startLine = lineNum;
        const startCol = col;
        let end = i + 3;
        let localLine = lineNum;
        let localCol = col + 3;
        while (end < len) {
            if (content[end] === '\n') { localLine++; localCol = 0; } else localCol++;
            if (content[end] === '%' && content[end+1] === '>') {
                end += 2;
                break;
            }
            end++;
        }
        if (end >= len) {
            console.log('UNCLOSED expression at line', startLine, 'col', startCol);
            process.exit(1);
        }
        i = end;
        lineNum = localLine;
        col = localCol;
        continue;
    }

    if (content[i] === '\n') { lineNum++; col = 0; } else col++;
    i++;
}
console.log('No unclosed EJS tag found in pagination.ejs');
