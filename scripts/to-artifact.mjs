// Turns the Vite single-file build into the page fragment the claude.ai Artifact
// publisher expects (it adds its own doctype/head/body skeleton).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const out = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<html[^>]*>\s*/i, '')
  .replace(/<\/html>\s*/i, '')
  .replace(/<head>\s*/i, '')
  .replace(/<\/head>\s*/i, '')
  .replace(/<body>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/parchi.html', out);
console.log('artifact/parchi.html', out.length, 'bytes; title at', out.indexOf('<title>'));
