import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" fill="#4285f4" rx="40"/>
  <text x="128" y="155" text-anchor="middle" font-size="120" fill="white" font-family="Arial" font-weight="bold">FB</text>
</svg>`;

const buf = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(resolve(__dirname, 'public', 'icon.png'), buf);
console.log('icon.png created');