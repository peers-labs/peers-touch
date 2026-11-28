import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import postcss from 'postcss';

const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
export const ts = require('typescript');
export const unparen = node => ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;

export function visit(node, action) {
  action(node);
  ts.forEachChild(node, child => visit(child, action));
}

export function parseSource(root, relative) {
  const full = containedFile(root, relative);
  const ast = ts.createSourceFile(full, fs.readFileSync(full, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (ast.parseDiagnostics.length) reject('UI_SURFACE_ADAPTER_INVALID', `${relative}: invalid syntax`);
  return ast;
}

/** Binding uses TS symbols, so a same-name parameter cannot impersonate an import. */
export function sourceChecker(ast) {
  const options = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = file => file === ast.fileName ? ast : undefined;
  const program = ts.createProgram([ast.fileName], options, host);
  return program.getTypeChecker();
}

export function resolveImport(root, from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier.split('?')[0]));
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.mjs`, `${base}.js`,
    `${base}/index.tsx`, `${base}/index.ts`, `${base}/index.js`];
  const relative = candidates.find(value => fs.existsSync(path.join(root, value))
    && fs.statSync(path.join(root, value)).isFile());
  if (!relative) reject('UI_SURFACE_SOURCE_MISSING', `${from}: ${specifier}`);
  containedFile(root, relative);
  return relative;
}

export function sourceImports(ast, { runtimeOnly = false } = {}) {
  const imports = [];
  visit(ast, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly
        || node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
          && node.importClause.namedBindings.elements.every(item => item.isTypeOnly);
      if (!runtimeOnly || !typeOnly) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || node.expression.getText() === 'require')) {
      if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) {
        reject('UI_SURFACE_DYNAMIC_DEPENDENCY', ast.fileName);
      }
      imports.push(node.arguments[0].text);
    }
  });
  return imports;
}

function cssImports(text, relative) {
  const imports = [];
  postcss.parse(text, { from: relative }).walkAtRules(/^import$/i, rule => {
    const match = rule.params.match(/^\s*(?:url\(\s*(?:(["'])(.*?)\1|([^)\s]+))\s*\)|(["'])(.*?)\4)/i);
    if (!match) reject('UI_SURFACE_DYNAMIC_DEPENDENCY', `${relative}: ${rule.params}`);
    imports.push(match[2] ?? match[3] ?? match[5]);
  });
  return imports;
}

/** Follow dedicated local dependencies; package primitives retain their own contract. */
export function surfaceSourceFiles(root, surface) {
  const seeds = surface.presentationRoots.flatMap(relative => filesUnder(root, relative))
    .filter(relative => !/\.(test|spec)\.[^.]+$/.test(relative))
    .concat(surface.prototype.adapter);
  const found = new Set();
  function add(relative) {
    if (found.has(relative)) return;
    found.add(relative);
    const text = fs.readFileSync(containedFile(root, relative), 'utf8');
    const imports = /\.[cm]?[jt]sx?$/.test(relative) ? sourceImports(parseSource(root, relative), { runtimeOnly: true })
      : relative.endsWith('.css') ? cssImports(text, relative)
        : [];
    for (const specifier of imports) {
      const local = relative.endsWith('.css') && !/^(?:[a-z]+:|\/)/i.test(specifier)
        && !specifier.startsWith('.') ? `./${specifier}` : specifier;
      const dependency = resolveImport(root, relative, local);
      if (dependency) add(dependency);
    }
  }
  seeds.forEach(add);
  found.add(surface.exportFile);
  found.add(surface.contract);
  return [...found].sort();
}

const ignored = new Set(['node_modules', 'dist', 'build', '.local', 'coverage']);

export function reject(code, message) {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

export function containedFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)
    || relative.split('/').some(part => part === '..' || part === '.')) {
    reject('UI_SURFACE_PATH_INVALID', String(relative));
  }
  const full = path.resolve(root, relative);
  if (!full.startsWith(`${root}${path.sep}`)) reject('UI_SURFACE_PATH_INVALID', relative);
  if (!fs.existsSync(full)) reject('UI_SURFACE_SOURCE_MISSING', relative);
  if (!fs.realpathSync(full).startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
    reject('UI_SURFACE_PATH_INVALID', relative);
  }
  return full;
}

export function filesUnder(root, relative) {
  const full = containedFile(root, relative);
  if (fs.statSync(full).isFile()) return [relative];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name)) return [];
    if (entry.isSymbolicLink()) reject('UI_SURFACE_PATH_INVALID', `${relative}/${entry.name}: source symlink`);
    return filesUnder(root, `${relative.replace(/\/$/, '')}/${entry.name}`);
  }).sort();
}
