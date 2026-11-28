import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { containedFile, reject } from './ui-surface-source.mjs';

const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const ts = require('typescript');
const unparen = node => ts.isParenthesizedExpression(node) ? unparen(node.expression) : node;
const tag = node => node.tagName.getText();

function parse(root, relative) {
  const ast = ts.createSourceFile(relative, fs.readFileSync(containedFile(root, relative), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (ast.parseDiagnostics.length) reject('UI_SURFACE_ADAPTER_INVALID', `${relative}: invalid syntax`);
  return ast;
}

function visit(node, action) {
  action(node);
  ts.forEachChild(node, child => visit(child, action));
}

function resolveImport(root, from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return [base, `${base}.tsx`, `${base}.ts`, `${base}.css`, `${base}/index.tsx`, `${base}/index.ts`]
    .find(relative => fs.existsSync(path.join(root, relative))) ?? null;
}

function verifyChain(root, host) {
  for (let i = 0; i < host.entryChain.length - 1; i++) {
    const from = host.entryChain[i], to = host.entryChain[i + 1];
    const ast = parse(root, from);
    const imports = [];
    visit(ast, node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        imports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    });
    if (!imports.some(specifier => resolveImport(root, from, specifier) === to)) {
      reject('UI_SURFACE_ENTRY_DISCONNECTED', `${from} does not consume ${to}`);
    }
  }
}

function verifyAdapter(root, surface, host) {
  const ast = parse(root, host.adapter);
  const bindings = new Set();
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === surface.package
      && !node.importClause?.isTypeOnly && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const item of node.importClause.namedBindings.elements) {
        if (!item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === surface.component) {
          bindings.add(item.name.text);
        }
      }
    }
  }
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === host.symbol
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const returns = fn?.body?.statements.filter(ts.isReturnStatement) ?? [];
  const expression = returns.length === 1 && returns[0].expression ? unparen(returns[0].expression) : null;
  if (!expression || !ts.isJsxSelfClosingElement(expression) || !bindings.has(tag(expression))) {
    reject('UI_SURFACE_ADAPTER_REIMPLEMENTED', `${host.adapter}: ${host.symbol} must return the shared surface directly`);
  }
  visit(ast, node => {
    if (ts.isJsxFragment(node)) reject('UI_SURFACE_ADAPTER_REIMPLEMENTED', `${host.adapter}: local fragment`);
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node !== expression && !host.allowedSlotTags.includes(tag(node))) {
        reject('UI_SURFACE_ADAPTER_REIMPLEMENTED', `${host.adapter}: local <${tag(node)}>`);
      }
      if (node.attributes.properties.some(prop => ts.isJsxAttribute(prop)
        && ['style', 'dangerouslySetInnerHTML'].includes(prop.name.getText()))) {
        reject('UI_SURFACE_LOCAL_STYLE', host.adapter);
      }
    }
    if (ts.isCallExpression(node) && /(?:createElement|createPortal|insertAdjacentHTML|setAttribute)$/.test(node.expression.getText())) {
      reject('UI_SURFACE_ADAPTER_REIMPLEMENTED', `${host.adapter}: local DOM factory`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && /\.(?:style|innerHTML|outerHTML)(?:\.|\[|$)/.test(node.left.getText())) {
      reject('UI_SURFACE_LOCAL_STYLE', host.adapter);
    }
  });
}

export function verifySurfaceAdapters(root, surfaces) {
  const implementations = new Map();
  for (const surface of surfaces.filter(value => value.status !== 'superseded')) {
    const ast = parse(root, surface.exportFile);
    const exported = ast.statements.find(node => ts.isExportDeclaration(node)
      && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(item => item.name.text === surface.component && !item.isTypeOnly));
    const implementation = exported && resolveImport(root, surface.exportFile, exported.moduleSpecifier.text);
    if (!implementation || !surface.presentationRoots.some(relative =>
      implementation === relative || implementation.startsWith(relative))) {
      reject('UI_SURFACE_EXPORT_DISCONNECTED', surface.id);
    }
    implementations.set(surface.id, implementation);
    for (const host of [surface.prototype, surface.production]) {
      verifyChain(root, host);
      verifyAdapter(root, surface, host);
    }
  }
  return implementations;
}
