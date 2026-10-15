// Builds submission/slides/slides.html from the template, pulling real code excerpts
// from the engine (syntax-highlighted) so the slides always match the repository.
import { readFileSync, writeFileSync } from 'node:fs';
import hljs from 'highlight.js/lib/core';
import ts from 'highlight.js/lib/languages/typescript';
hljs.registerLanguage('typescript', ts);

const lines = (file, a, b) => readFileSync(file, 'utf8').split('\n').slice(a - 1, b);
const dedent = (ls) => {
  const n = Math.min(...ls.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return ls.map((l) => l.slice(n));
};
const hl = (...parts) => parts.map((p) => hljs.highlight(dedent(p).join('\n'), { language: 'typescript' }).value).join('\n<span class="gap">  …</span>\n');
const find = (file, needle) => readFileSync(file, 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;

const gl = 'src/engine/global.ts', lx = 'src/engine/lexicon.ts', ma = 'src/engine/match.ts', iv = 'src/engine/invoice.ts';
const p1 = find(gl, "name: 'Spanish'");
const p2 = find(lx, '// ---- merge the global language packs');
const code1 = hl(lines(gl, p1 - 1, p1 + 6), lines(lx, p2, p2 + 9));
const m1 = find(ma, '// Text similarity tops out');
const m2 = find(ma, '// 3. structured agreement');
const m3 = find(ma, '// 4. customer history');
const code2 = hl(lines(ma, m1, m1 + 2), lines(ma, m2, m2 + 9), lines(ma, m3 + 3, m3 + 9));
const i1 = find(iv, 'const taxRate = ');
const code3 = hl(lines(iv, i1, i1 + 9));

const tests = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
  .filter((l, i, a) => i < 4 || l.includes('Tests') || l.includes('invoice >') || l.includes('global languages'))
  .map((l) => l.replace('tests/engine.test.ts > ', '').replace(/✓/, '<span class="ok">✓</span>'))
  .join('\n');

let x = 9301;
const wave = Array.from({ length: 34 }, (_, i) => {
  x = (x * 9301 + 49297) % 233280;
  return `<s style="height:${(0.6 + (Math.sin(i / 2.6) * 0.5 + 0.5) * 1.4 + (x / 233280) * 0.6).toFixed(2)}rem"></s>`;
}).join('');

const out = readFileSync('submission/slides/template.html', 'utf8')
  .replace('__CODE1__', code1).replace('__CODE2__', code2).replace('__CODE3__', code3)
  .replace('__TESTS__', tests).replace('__WAVE__', wave)
  .replace('__PARCHI__', '../../assets/sample-parchi.jpg')
  .replace('__DEMO__', process.env.DEMO_URL ?? 'claude.ai/artifact/HiDLiNUbpPLqL7FykEkN2y')
  .replace('__REPO__', process.env.REPO_URL ?? 'GitHub link in the project description');
writeFileSync('submission/slides/slides.html', out);
console.log('slides built');
