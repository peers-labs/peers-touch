'use strict';

// Observe the installed CLI and its actual version-switch child. The preload
// changes no selection, arguments, spawn implementation or configuration.
const fs = require('node:fs');
const {createRequire, getCompileCacheDir} = require('node:module');
const worker = fs.realpathSync(__filename);
const direct = fs.realpathSync(process.argv[1]) === worker;
if (direct) {
  process.argv = [process.execPath, fs.realpathSync(process.argv[2]),
                  ...process.argv.slice(3)];
  process.env.NODE_OPTIONS = '--require=' + JSON.stringify(worker);
}
const entry = fs.realpathSync(process.argv[1]);
if (process.env.NODE_DISABLE_COMPILE_CACHE !== '1') {
  throw new Error('pnpm observation requires disabled Node compile cache');
}
let optionalCache;
try {
  createRequire(entry).resolve('v8-compile-cache');
  throw new Error('pnpm optional cache requires its own input owner');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  optionalCache = {absent: true};
}
process.once('exit', (code) => {
  if (code !== 0 || getCompileCacheDir() !== undefined) return;
  fs.writeSync(1, '\nPT_PNPM_INSTALLATION_OBSERVATION=' + JSON.stringify({
    entry, executable: fs.realpathSync(process.execPath),
    versions: process.versions, architecture: process.arch, platform: process.platform,
    modules: Object.keys(require.cache).filter((name) => name !== worker).sort(),
    libraries: process.report.getReport().sharedObjects.sort(),
    optionalCache, compileCacheDisabled: true,
  }) + '\n');
});
if (direct) require(entry);
