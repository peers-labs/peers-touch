// Preserve one outer observation across repeated Node hook registrations.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createRequire} from 'node:module';

const observer = createRequire(import.meta.url)('./node_execution_observation.cjs');
const delegation = new AsyncLocalStorage();

export function initialize(phase) { observer.setAsyncPhase(phase); }

export async function resolve(specifier, context, nextResolve) {
  if (delegation.getStore()?.operation === 'resolve') {
    return await nextResolve(specifier, context);
  }
  const phase = observer.getAsyncPhase();
  return await delegation.run({operation: 'resolve'}, async () => {
    let value;
    try {
      value = await nextResolve(specifier, context);
    } catch (error) {
      observer.observeAsyncResolutionFailure(specifier, context, error, phase);
      throw error;
    }
    observer.observeAsyncResolution(specifier, context, value, phase);
    return value;
  });
}

export async function load(url, context, nextLoad) {
  if (delegation.getStore()?.operation === 'load') {
    return await nextLoad(url, context);
  }
  const phase = observer.getAsyncPhase();
  return await delegation.run({operation: 'load'}, async () => {
    const before = observer.beginAsyncLoad(url);
    const value = await nextLoad(url, context);
    observer.observeAsyncLoad(url, value, before, phase);
    return value;
  });
}
