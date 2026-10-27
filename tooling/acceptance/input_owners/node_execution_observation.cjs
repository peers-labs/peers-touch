'use strict';

// Observe normal resolution/loading without replacing the tool, its arguments,
// or its cache selection. This is an input trace, never complete build proof.
const fs = require('node:fs');
const crypto = require('node:crypto');
const moduleApi = require('node:module');
const {fileURLToPath} = require('node:url');
const threads = require('node:worker_threads');
const worker = fs.realpathSync(__filename);
const allowed = JSON.parse(process.env.PT_NODE_OBSERVATION_ENTRIES);
const bindingKey = 'PT_NODE_EXECUTION_OBSERVER:' + worker;
const inherited = threads.getEnvironmentData(bindingKey);
const context = {
  pid: process.pid, threadId: threads.threadId,
  isMainThread: threads.isMainThread, isInternalThread: threads.isInternalThread,
};
// Node's asynchronous loader is an internal thread with no CLI argv[1].
// Bind its actual caller through Node's thread data, never a guessed entry.
const entry = !context.isMainThread
  ? inherited?.entry
  : typeof process.argv[1] === 'string' ? fs.realpathSync(process.argv[1]) : null;
const threadEntry = !context.isMainThread && !context.isInternalThread
  ? inherited?.threadEntry ?? null : null;
if (!Array.isArray(allowed) || !allowed.includes(entry)
    || typeof moduleApi.registerHooks !== 'function'
    || (!context.isMainThread && (
      inherited?.pid !== process.pid || inherited?.observer !== worker
      || fs.realpathSync(entry) !== entry
    ))) {
  throw new Error('Unqualified Node input observation entry');
}
if (context.isMainThread) {
  threads.setEnvironmentData(bindingKey, {pid: process.pid, entry, observer: worker});
}
const bytes = (value) => crypto.createHash('sha256').update(value).digest('hex');
const modules = new Map();
const registrarModules = new Map();
let asyncPhase = 'runtime';
const resolutions = [];
const failures = [];
let complete = context.isMainThread;
const reject = (message) => {
  complete = false;
  throw new Error(message);
};
const cache = () => ({
  directory: moduleApi.getCompileCacheDir() ?? null,
  disabled: process.env.NODE_DISABLE_COMPILE_CACHE === '1',
  configuredDirectory: process.env.NODE_COMPILE_CACHE ?? null,
});
const initialCache = cache();
const location = (url) => {
  if (url.startsWith('node:')) return null;
  if (!url.startsWith('file:')) reject('Unowned Node module URL');
  return fileURLToPath(url);
};
const recordLoad = (filename, value, before, inventory = modules) => {
  if (value.format !== undefined
      && !['commonjs', 'module', 'json', 'addon', 'wasm'].includes(value.format)) {
    // Preserve real formats while their compiler provenance remains unclosed.
    complete = false;
  }
  if (!before.equals(fs.readFileSync(filename))
      || modules.size + registrarModules.size >= 4096) {
    reject('Node loaded input drift or inventory exceeded');
  }
  const row = {
    path: filename, resolved: fs.realpathSync(filename), format: value.format ?? null,
    fileBytes: bytes(before),
    loadedSourceBytes: value.source == null ? null : bytes(
      typeof value.source === 'string' ? value.source
        : Buffer.from(value.source.buffer ?? value.source,
                      value.source.byteOffset ?? 0, value.source.byteLength),
    ),
    cache: cache(),
  };
  if (inventory.has(filename)
      && JSON.stringify(inventory.get(filename)) !== JSON.stringify(row)) {
    reject('Node loaded input changed within one process');
  }
  inventory.set(filename, row);
  return row;
};
// The asynchronous loader cannot delegate a synchronous hook to its own
// thread. Its explicit incomplete sample retains this observation boundary.
const synchronousHooks = !context.isInternalThread ? moduleApi.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (resolutions.length + failures.length >= 8192) {
      reject('Node resolution input inventory exceeded');
    }
    try {
      const value = nextResolve(specifier, context);
      location(value.url);
      resolutions.push({
        specifier, parent: context.parentURL ?? null, url: value.url,
        conditions: [...context.conditions].sort(),
      });
      return value;
    } catch (error) {
      failures.push({
        specifier, parent: context.parentURL ?? null, code: error.code ?? null,
      });
      throw error;
    }
  },
  load(url, context, nextLoad) {
    const filename = location(url);
    if (!filename) return nextLoad(url, context);
    const before = fs.readFileSync(filename);
    const value = nextLoad(url, context);
    recordLoad(filename, value, before);
    return value;
  },
}) : null;
let sampleSequence = 0;
const emit = (
  event, exitCode = null, selectedModules = modules,
  selectedResolutions = null, selectedFailures = null,
) => {
  const observedModules = [];
  for (const [filename, row] of selectedModules) {
    let postLoad;
    try {
      const fileBytes = bytes(fs.readFileSync(filename));
      const resolved = fs.realpathSync(filename);
      const state = fileBytes === row.fileBytes && resolved === row.resolved
        ? 'present' : 'changed';
      postLoad = {state, fileBytes, resolved};
    } catch (error) {
      postLoad = {
        state: error.code === 'ENOENT' ? 'absent' : 'unreadable',
        errorCode: error.code ?? null,
      };
    }
    // A producer may delete its generated configuration after loading it.
    // Retain that lifetime gap without interrupting the actual tool.
    if (postLoad.state !== 'present') complete = false;
    observedModules.push({...row, postLoad});
  }
  const output = Buffer.from(JSON.stringify({
    entry, executable: fs.realpathSync(process.execPath),
    versions: process.versions, architecture: process.arch, platform: process.platform,
    cwd: process.cwd(), path: process.env.PATH, nodePath: process.env.NODE_PATH ?? null,
    initialCache, finalCache: cache(),
    modules: observedModules.sort((left, right) => left.path.localeCompare(right.path)),
    resolutions: selectedResolutions ?? (event === 'async-module-loaded' ? [] : resolutions),
    failures: selectedFailures ?? failures,
    libraries: process.report.getReport().sharedObjects.sort(),
    observer: worker, context, threadEntry, complete, event, exitCode,
  }));
  if (output.length > 16 * 1024 * 1024) reject('Node input output inventory exceeded');
  const ends = process.hrtime.bigint() + 2_000_000_000n;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const identity = [context.pid, context.threadId, sampleSequence++, bytes(output)].join(':');
  const chunks = Math.ceil(output.length / 240);
  // POSIX guarantees atomic pipe writes only through 512 bytes. Each fragment
  // has its own identity; a terminated Worker cannot orphan a shared mutex.
  for (let index = 0; index < chunks; index++) {
    const fragment = output.subarray(index * 240, (index + 1) * 240).toString('base64');
    const frame = Buffer.from(
      '\nPT_NODE_EXECUTION_INPUTS=' + identity + ':' + index + ':' + chunks + ':' + fragment + '\n',
    );
    if (frame.length > 512) reject('Node input atomic frame exceeded');
    for (;;) {
      if (process.hrtime.bigint() >= ends) reject('Node input output deadline expired');
      try {
        if (fs.writeSync(1, frame) !== frame.length) reject('Node input atomic write was partial');
        break;
      } catch (error) {
        if (!['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(error.code)) throw error;
        Atomics.wait(pause, 0, 0, 1);
      }
    }
  }
};
const originalWorker = threads.Worker;
threads.Worker = new Proxy(originalWorker, {
  construct(target, arguments_, newTarget) {
    complete = false;
    let selectedEntry = null;
    if (!arguments_[1]?.eval) {
      try {
        const selected = arguments_[0] instanceof URL
          ? fileURLToPath(arguments_[0]) : arguments_[0];
        if (typeof selected === 'string') selectedEntry = fs.realpathSync(selected);
      } catch {}
    }
    const previous = threads.getEnvironmentData(bindingKey);
    // Worker preload also precedes argv[1] setup. Node snapshots this binding
    // during the unchanged constructor; restore the caller's data immediately.
    threads.setEnvironmentData(bindingKey, {
      pid: process.pid, entry, observer: worker, threadEntry: selectedEntry,
    });
    let value;
    try {
      value = Reflect.construct(
        target, arguments_, newTarget === threads.Worker ? target : newTarget,
      );
    } finally {
      threads.setEnvironmentData(bindingKey, previous);
    }
    emit('worker-created');
    return value;
  },
});
// Registration owns a separate loader and transferred options. Observe the
// unchanged call, but keep its provenance incomplete in the caller too.
const originalRegister = moduleApi.register;
moduleApi.register = function(...arguments_) {
  complete = false;
  // Async CommonJS may legitimately return source:null; Node's synchronous
  // hook validator cannot accept that delegation. End this trace boundary
  // before the real registration instead of changing the loader result.
  synchronousHooks?.deregister();
  const adapter = require('node:url').pathToFileURL(
    require('node:path').join(__dirname, 'node_async_execution_observation.mjs'),
  ).href;
  const observe = (phase) => Reflect.apply(originalRegister, moduleApi, [
    adapter, {parentURL: require('node:url').pathToFileURL(worker).href, data: phase},
  ]);
  observe('registration');
  let succeeded = false;
  try {
    const result = Reflect.apply(originalRegister, this, arguments_);
    succeeded = true;
    return result;
  } finally {
    // Restore runtime sampling even when the original registration throws.
    observe('runtime');
    emit(succeeded ? 'loader-registered' : 'loader-registration-failed');
  }
};
moduleApi.syncBuiltinESMExports();
if (!context.isMainThread) {
  emit(context.isInternalThread ? 'loader-initialized' : 'worker-initialized');
}
// A native CLI may exit through Rust/libc without firing Node's exit event.
// Report the completed real dlopen call too; never label that sample a terminal.
const originalDlopen = process.dlopen;
process.dlopen = function(...arguments_) {
  const filename = arguments_[1];
  const before = fs.readFileSync(filename);
  const result = Reflect.apply(originalDlopen, this, arguments_);
  if (!before.equals(fs.readFileSync(filename))) reject('Native module input drift');
  const row = {
    path: filename, resolved: fs.realpathSync(filename), format: 'addon',
    fileBytes: bytes(before), loadedSourceBytes: null, cache: cache(),
  };
  if (!modules.has(filename) && modules.size + registrarModules.size >= 4096) {
    reject('Native module input inventory exceeded');
  }
  modules.set(filename, row);
  emit('native-library-loaded');
  return result;
};
process.once('exit', (code) => {
  emit('exit', code);
});
module.exports = {
  setAsyncPhase(phase) { asyncPhase = phase; },
  getAsyncPhase() { return asyncPhase; },
  observeAsyncResolution(specifier, context, value, phase = 'runtime') {
    if (resolutions.length + failures.length >= 8192) {
      reject('Async resolution inventory exceeded');
    }
    const row = {
      specifier, parent: context.parentURL ?? null, url: value.url,
      conditions: [...context.conditions].sort(),
    };
    resolutions.push(row);
    emit(phase === 'registration' ? 'async-registrar-module-resolved'
      : 'async-module-resolved', null, new Map(), [row], []);
  },
  observeAsyncResolutionFailure(specifier, context, error, phase = 'runtime') {
    if (resolutions.length + failures.length >= 8192) {
      reject('Async resolution inventory exceeded');
    }
    const row = {
      specifier, parent: context.parentURL ?? null, code: error.code ?? null,
    };
    failures.push(row);
    emit(phase === 'registration' ? 'async-registrar-resolution-failed'
      : 'async-resolution-failed', null, new Map(), [], [row]);
  },
  beginAsyncLoad(url) {
    return url.startsWith('file:') ? fs.readFileSync(fileURLToPath(url)) : null;
  },
  observeAsyncLoad(url, value, before, phase = 'runtime') {
    if (before === null) return;
    const filename = fileURLToPath(url);
    const row = recordLoad(filename, value, before,
      phase === 'registration' ? registrarModules : modules);
    emit(phase === 'registration' ? 'async-registrar-module-loaded'
      : 'async-module-loaded', null, new Map([[filename, row]]), [], []);
  },
};
