import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { containedFile, filesUnder, reject } from './ui-surface-source.mjs';

export function verifySurfaceStyles(root, surfaces) {
  const prefixes = [...new Set(surfaces.flatMap(surface => surface.protectedClasses))];
  for (const scanRoot of ['apps/desktop/src', 'apps/mobile/src', 'packages/prototypes']) {
    if (!fs.existsSync(path.join(root, scanRoot))) continue;
    for (const relative of filesUnder(root, scanRoot).filter(file => file.endsWith('.css'))) {
      const css = postcss.parse(fs.readFileSync(containedFile(root, relative), 'utf8'), { from: relative });
      css.walkRules(rule => {
        if (rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
        try {
          selectorParser(selectors => selectors.walk(node => {
            const values = node.type === 'class' ? [node.value]
              : node.type === 'attribute' && node.attribute.toLowerCase() === 'class'
                ? (node.value ?? '').split(/\s+/) : [];
            if (values.some(value => prefixes.some(prefix => value.includes(prefix)))) {
              reject('UI_SURFACE_LOCAL_STYLE', `${relative}: ${rule.selector}`);
            }
          // Inspect nonstandard != operators as = as well, including forgiving
          // :is() lists. Never discard a rule that has a valid protected branch.
          })).processSync(rule.selector.replace(/!=/g, '='));
        } catch (error) {
          if (error.code) throw error;
          reject('UI_SURFACE_CSS_INVALID', `${relative}: ${rule.selector}: ${error.message}`);
        }
      });
    }
  }
}
