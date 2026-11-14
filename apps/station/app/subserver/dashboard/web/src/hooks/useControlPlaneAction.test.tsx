// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAuthToken } from '../api/client';
import { useControlPlaneAction } from './useControlPlaneAction';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setAuthToken('administrator-a');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it.each(['account change', 'page close'])('discards a validated draft after %s', async (change) => {
  const validation = deferred();
  const finished = deferred();
  const write = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  function Form() {
    const { run } = useControlPlaneAction(refresh);
    return <button onClick={async () => {
      await validation.promise;
      await run(write);
      finished.resolve();
    }}>Save</button>;
  }
  await act(async () => root.render(<Form />));
  await act(async () => host.querySelector('button')!.click());
  await act(async () => {
    if (change === 'account change') setAuthToken('administrator-b');
    else root.render(null);
  });
  await act(async () => {
    validation.resolve();
    await finished.promise;
  });
  expect(write).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('does not refresh the new account when an old write finishes', async () => {
  const dispatched = deferred();
  const write = deferred();
  const finished = deferred();
  const refresh = vi.fn().mockResolvedValue(undefined);
  function Form() {
    const { run } = useControlPlaneAction(refresh);
    return <button onClick={async () => {
      await run(() => { dispatched.resolve(); return write.promise; });
      finished.resolve();
    }}>Save</button>;
  }
  await act(async () => root.render(<Form />));
  await act(async () => { host.querySelector('button')!.click(); await dispatched.promise; });
  await act(async () => {
    setAuthToken('administrator-b');
    write.resolve();
    await finished.promise;
  });
  expect(refresh).not.toHaveBeenCalled();
});
