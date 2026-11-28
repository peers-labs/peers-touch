import {
  parseSource as parse, reject, resolveImport, sourceChecker, sourceImports, ts, unparen, visit,
} from './ui-surface-source.mjs';
const tag = node => node.tagName.getText();

function verifyChain(root, host) {
  for (let i = 0; i < host.entryChain.length - 1; i++) {
    const from = host.entryChain[i], to = host.entryChain[i + 1];
    const ast = parse(root, from);
    const imports = sourceImports(ast, { runtimeOnly: true });
    if (!imports.some(specifier => resolveImport(root, from, specifier) === to)) {
      reject('UI_SURFACE_ENTRY_DISCONNECTED', `${from} does not consume ${to}`);
    }
    // A general shell can own its layout. Dedicated intermediate hosts cannot paint.
    verifyNoStyleInjection(ast, from, i > 0);
  }
}

function verifyNoStyleInjection(ast, relative, dedicated) {
  visit(ast, node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (['style', 'script'].includes(tag(node))) reject('UI_SURFACE_LOCAL_STYLE', relative);
      if (node.attributes.properties.some(prop => ts.isJsxAttribute(prop)
        && (prop.name.getText() === 'dangerouslySetInnerHTML'
          || dedicated && prop.name.getText() === 'style'))) reject('UI_SURFACE_LOCAL_STYLE', relative);
    }
    if (ts.isCallExpression(node) && /(?:insertAdjacentHTML|insertRule|replaceSync|setAttribute)$/.test(node.expression.getText())) {
      reject('UI_SURFACE_LOCAL_STYLE', relative);
    }
    if (ts.isCallExpression(node) && /createElement$/.test(node.expression.getText())
      && node.arguments.some(arg => ts.isStringLiteral(arg) && ['style', 'script'].includes(arg.text))) {
      reject('UI_SURFACE_LOCAL_STYLE', relative);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && /(?:\.|\[['"])(?:style|innerHTML|outerHTML|textContent)(?:\.|\[|['"]\]|$)/.test(node.left.getText())) {
      reject('UI_SURFACE_LOCAL_STYLE', relative);
    }
  });
}

function hookObject(node, checker, relative, references) {
  node = unparen(node);
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    const declaration = symbol?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer
      || !(declaration.parent.flags & ts.NodeFlags.Const)) reject('UI_SURFACE_HOOKS_INVALID', relative);
    const allowed = references.get(symbol) ?? new Set([declaration.name]);
    allowed.add(node);
    references.set(symbol, allowed);
    return hookObject(declaration.initializer, checker, relative, references);
  }
  if (ts.isCallExpression(node)) {
    const declaration = checker.getSymbolAtLocation(node.expression)?.declarations?.[0];
    const imported = declaration && ts.isImportSpecifier(declaration)
      && (declaration.propertyName?.text ?? declaration.name.text) === 'useMemo'
      && declaration.parent.parent.parent.moduleSpecifier.text === 'react';
    const fn = node.arguments[0];
    if (imported && fn && ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
      return hookObject(fn.body, checker, relative, references);
    }
  }
  if (!ts.isObjectLiteralExpression(node) || node.properties.some(prop => !ts.isPropertyAssignment(prop))) {
    reject('UI_SURFACE_HOOKS_INVALID', `${relative}: hooks must have explicit properties`);
  }
  return node;
}

function verifyHooks(expression, checker, surface, relative) {
  const references = new Map();
  for (const attribute of expression.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) reject('UI_SURFACE_HOOKS_INVALID', `${relative}: spread props`);
    if (attribute.name.getText() !== 'hooks') continue;
    const value = attribute.initializer?.expression;
    if (!value) reject('UI_SURFACE_HOOKS_INVALID', relative);
    const object = hookObject(value, checker, relative, references);
    for (const prop of object.properties) {
      const name = prop.name.getText().replace(/^['"]|['"]$/g, '');
      if (!['classNames', 'dataAttributes'].includes(name)) reject('UI_SURFACE_HOOKS_INVALID', relative);
      const regions = hookObject(prop.initializer, checker, relative, references);
      for (const region of regions.properties) {
        const value = unparen(region.initializer);
        if (name === 'classNames') {
          if (!ts.isStringLiteral(value) || !value.text.trim() || value.text.split(/\s+/)
            .some(className => !surface.protectedClasses.some(prefix => className.startsWith(prefix)))) {
            reject('UI_SURFACE_HOOKS_INVALID', `${relative}: unprotected/dynamic hook class`);
          }
        } else {
          const attributes = hookObject(value, checker, relative, references);
          if (attributes.properties.some(item => !/^['"]data-[a-z0-9-]+['"]$/.test(item.name.getText()))) {
            reject('UI_SURFACE_HOOKS_INVALID', `${relative}: only data attributes`);
          }
        }
      }
    }
  }
  visit(expression.getSourceFile(), node => {
    if (!ts.isIdentifier(node)) return;
    const allowed = references.get(checker.getSymbolAtLocation(node));
    if (allowed && !allowed.has(node)) {
      reject('UI_SURFACE_HOOKS_INVALID', `${relative}: hook object escapes its declaration and shared prop`);
    }
  });
}

function verifyAdapter(root, surface, host) {
  const ast = parse(root, host.adapter);
  const checker = sourceChecker(ast);
  const bindings = new Set();
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === surface.package
      && !node.importClause?.isTypeOnly && node.importClause?.namedBindings
      && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const item of node.importClause.namedBindings.elements) {
        if (!item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === surface.component) {
          bindings.add(checker.getSymbolAtLocation(item.name));
        }
      }
    }
  }
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === host.symbol
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const returns = fn?.body?.statements.filter(ts.isReturnStatement) ?? [];
  const expression = returns.length === 1 && returns[0].expression ? unparen(returns[0].expression) : null;
  if (!expression || !ts.isJsxSelfClosingElement(expression)
    || !bindings.has(checker.getSymbolAtLocation(expression.tagName))) {
    reject('UI_SURFACE_ADAPTER_REIMPLEMENTED', `${host.adapter}: ${host.symbol} must return the shared surface directly`);
  }
  verifyHooks(expression, checker, surface, host.adapter);
  verifyNoStyleInjection(ast, host.adapter, true);
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
      && !node.isTypeOnly && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(item => item.name.text === surface.component && !item.isTypeOnly));
    const implementation = exported && resolveImport(root, surface.exportFile, exported.moduleSpecifier.text);
    if (!implementation || !surface.presentationRoots.some(relative =>
      implementation === relative || implementation.startsWith(relative.endsWith('/') ? relative : `${relative}/`))) {
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
