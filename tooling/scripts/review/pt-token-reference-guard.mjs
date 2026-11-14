#!/usr/bin/env node
/**
 * pt-token-reference-guard.mjs
 *
 * Fails if any `var(--pt-*)` reference in the desktop renderer points at a
 * custom property the token package never emits and that is not defined as a
 * local alias/extension point. A wrong token name (e.g. `--pt-font-mono`
 * instead of the emitted `--pt-mono`) silently degrades to the generic CSS
 * fallback and is otherwise invisible to type-checking.
 *
 * Emission contract (packages/ui/tokens/src/index.ts tokenVariables):
 *   - color keys          -> --pt-<key>            (hex or rgb/rgba)
 *   - nested geometry     -> --pt-<group>-<key>    (radius/space/control/motion)
 *   - specials            -> --pt-font / --pt-mono / --pt-shadow-{rest,soft,float}
 *
 * A `var(--pt-x, <fallback>)` used purely as a host-overridable extension
 * point is allowed when it always carries an explicit non-empty fallback;
 * those names are listed in ALLOWED_EXTENSION_VARS.
 *
 * Usage: node tooling/scripts/review/pt-token-reference-guard.mjs [root]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

const ROOT = process.argv[2] ?? process.cwd();
const TOKENS_DIR = `${ROOT}/packages/ui/tokens/src`;
const SCAN_DIR = `${ROOT}/apps/desktop/src`;

// Host-overridable extension points with an always-present explicit fallback.
const ALLOWED_EXTENSION_VARS = new Set([
  '--pt-auth-card-width',
  '--pt-z-overlay',
  // Injected at runtime by SocialChatPage from the manual ChatRailResizer
  // drag; every chat.css reference keeps the 300px default fallback.
  '--pt-chat-rail-width',
]);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    const s = statSync(path);
    if (s.isDirectory()) walk(path, acc);
    else if (/\.(css|tsx|ts)$/.test(entry)) acc.push(path);
  }
  return acc;
}

const emitted = new Set();
const indexSource = readFileSync(`${TOKENS_DIR}/index.ts`, 'utf8');
for (const group of ['radius', 'space', 'control', 'motion']) {
  const match = indexSource.match(new RegExp(`${group}:\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) continue;
  for (const k of match[1].matchAll(/([a-zA-Z0-9]+)\s*:/g)) {
    emitted.add(`--pt-${group}-${k[1]}`);
  }
}
for (const v of ['--pt-font', '--pt-mono', '--pt-shadow-rest', '--pt-shadow-soft', '--pt-shadow-float']) {
  emitted.add(v);
}
// Color keys: indented identifier whose value starts with #, rgb/rgba, or var().
const COLOR_KEY_RE = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*(?:'#|"#|'rgba|"rgba|'rgb|"rgb|var\()/gm;
for (const file of ['index.ts', 'north-star-theme.ts']) {
  const tokenFile = `${TOKENS_DIR}/${file}`;
  if (!existsSync(tokenFile)) continue;
  const src = readFileSync(tokenFile, 'utf8');
  for (const m of src.matchAll(COLOR_KEY_RE)) emitted.add(`--pt-${m[1]}`);
}

// Custom properties defined locally inside desktop CSS (aliases + extension vars).
const locallyDefined = new Set();
for (const path of walk(SCAN_DIR).filter((p) => p.endsWith('.css'))) {
  const src = readFileSync(path, 'utf8');
  for (const m of src.matchAll(/(--pt-[a-zA-Z0-9-]+)\s*:/g)) locallyDefined.add(m[1]);
}

let missing = 0;
for (const path of walk(SCAN_DIR)) {
  const src = readFileSync(path, 'utf8');
  for (const m of src.matchAll(/var\((--pt-[a-zA-Z0-9-]+)([^)]*)\)/g)) {
    const [, name, rest] = m;
    if (emitted.has(name) || locallyDefined.has(name)) continue;
    const hasFallback = rest.split(',').slice(1).join(',').trim().length > 0;
    if (ALLOWED_EXTENSION_VARS.has(name) && hasFallback) continue;
    console.error(`undefined --pt token reference: ${name} in ${path.replace(ROOT + '/', '')}`);
    missing += 1;
  }
}

if (missing > 0) {
  console.error(`\n${missing} unresolved --pt-* reference(s). Use an emitted token or define a local alias.`);
  process.exit(1);
}
console.log(`pt-token-reference-guard: OK (${emitted.size} emitted tokens; all references resolve)`);
