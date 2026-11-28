import path from 'node:path';
import fs from 'node:fs';
import {
  readSurfaceLedger, verifySurfaceAuthority,
} from './ui-surface-authority.mjs';
import { reject, surfaceSourceFiles } from './ui-surface-source.mjs';
import { verifySurfaceAdapters } from './ui-surface-adapters.mjs';

/** Production-only admission. The Prototype Portal deliberately renders drafts. */
export function uiSurfaceAuthorityPlugin(repoRoot) {
  const root = fs.realpathSync(path.resolve(repoRoot));
  let starting;
  const verify = () => JSON.stringify(verifySurfaceAuthority(root));
  return {
    name: 'peers-ui-surface-authority',
    enforce: 'pre',
    buildStart() { starting = verify(); },
    configureServer(server) {
      const surfaces = readSurfaceLedger(root);
      server.watcher.add(surfaces.flatMap(surface => surfaceSourceFiles(root, surface))
        .map(relative => path.join(root, relative)));
      server.watcher.add(path.join(root, 'docs/architecture/engineering/prototypes/README.md'));
      server.middlewares.use((request, response, next) => {
        if (!request.url?.includes('/src/') && !request.url?.includes('/@fs/')) return next();
        try { verify(); next(); }
        catch (error) {
          response.statusCode = 409;
          response.end(error.message);
        }
      });
    },
    handleHotUpdate() { verify(); },
    generateBundle(_options, bundle) {
      if (starting !== verify()) reject('UI_SURFACE_SOURCE_CHANGED_DURING_BUILD', 'restart with the confirmed source');
      const rendered = new Set(Object.values(bundle).filter(item => item.type === 'chunk')
        .flatMap(chunk => Object.entries(chunk.modules)
          .filter(([, value]) => value.renderedLength > 0)
          .map(([id]) => id.split('?')[0])));
      const surfaces = readSurfaceLedger(root).filter(value => value.status !== 'superseded');
      const implementations = verifySurfaceAdapters(root, surfaces);
      for (const surface of surfaces) {
        for (const relative of surface.production.entryChain.concat(implementations.get(surface.id))) {
          if (!rendered.has(path.join(root, relative))) reject('UI_SURFACE_ENTRY_NOT_BUNDLED', relative);
        }
      }
    },
  };
}
