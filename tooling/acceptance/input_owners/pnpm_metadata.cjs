'use strict';

// Observe the real pnpm Node delegate in a pipe, with the same JSON arguments.
const fs = require('node:fs');
const {getCompileCacheDir} = require('node:module');

if (process.env.NODE_DISABLE_COMPILE_CACHE !== '1') {
  throw new Error('Node compile cache must be disabled');
}
const entry = fs.realpathSync(process.argv[2]);
const delegateArguments = process.argv.slice(3);
process.argv = [process.execPath, entry, ...delegateArguments];
process.once('exit', (code) => {
  if (code !== 0 || getCompileCacheDir() !== undefined) return;
  const report = {
    modules: Object.keys(require.cache)
      .filter((filename) => filename !== __filename).sort(),
    libraries: process.report.getReport().sharedObjects.sort(),
    executable: fs.realpathSync(process.execPath),
  };
  fs.writeSync(1, '\nPT_PNPM_METADATA_OBSERVATION=' + JSON.stringify(report));
});
require(entry);
