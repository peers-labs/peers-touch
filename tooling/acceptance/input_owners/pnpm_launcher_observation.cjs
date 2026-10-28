'use strict';

// Only the requested real bin entry reports its inherited loader environment.
// Stop before tool code executes; this supplies no tool or build qualification.
const fs = require('node:fs');
const moduleApi = require('node:module');
const target = process.env.PT_PNPM_LAUNCHER_ENTRY;
if (process.argv[1] && fs.realpathSync(process.argv[1]) === target) {
  fs.writeSync(1, 'PT_PNPM_LAUNCHER_OBSERVATION=' + JSON.stringify({
    entry: fs.realpathSync(process.argv[1]),
    node: fs.realpathSync(process.execPath),
    cwd: process.cwd(), path: process.env.PATH, nodePath: process.env.NODE_PATH ?? null,
    globalPaths: moduleApi.globalPaths,
    compileCacheDisabled: process.env.NODE_DISABLE_COMPILE_CACHE === '1'
      && moduleApi.getCompileCacheDir() === undefined,
    libraries: process.report.getReport().sharedObjects.sort(),
  }) + '\n');
  process.exit(0);
}
