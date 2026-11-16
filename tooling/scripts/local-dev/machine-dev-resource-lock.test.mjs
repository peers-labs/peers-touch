import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { machineLeasePath } from '../lib/machine-dev-paths.mjs';

const helper = fileURLToPath(new URL('./machine-dev-lease.py', import.meta.url));
const uuid = 'AAAAAAAA-AAAA-4AAA-AAAA-AAAAAAAAAAAA';
const python = process.env.PT_TEST_PYTHON ?? 'python3';

function leaseArgs(home, kind, id, command) {
  return [helper, 'run', '--lease-file', machineLeasePath(kind, id, home),
    '--resource-kind', kind, '--resource-id', id, '--workspace-id', '0123456789abcdef',
    '--budget-seconds', '20', '--expected-branch', 'fixture', '--expected-head', 'a'.repeat(40),
    '--validation-command-json', JSON.stringify([process.execPath, '-e', 'process.exit(0)']),
    '--', ...command];
}

async function ready(child, marker) {
  const deadline = Date.now() + 5000;
  while (!existsSync(marker)) {
    assert.equal(child.exitCode, null, 'holder exited before ready');
    assert.ok(Date.now() < deadline, 'holder readiness budget exceeded');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('physical UUID lock excludes aliases and inherited child survives supervisor loss', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'pt-device-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const marker = path.join(home, 'child.json');
  const holder = spawn(python, leaseArgs(home, 'simulator.ios', uuid, [
    process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`,
  ]), { stdio: 'ignore' });
  const exited = new Promise((resolve) => holder.once('exit', resolve));
  let childPid;
  t.after(() => {
    if (holder.exitCode === null) holder.kill('SIGKILL');
    if (childPid) { try { process.kill(childPid, 'SIGKILL'); } catch {} }
  });
  await ready(holder, marker);
  childPid = JSON.parse(readFileSync(marker, 'utf8')).pid;
  const compete = () => spawnSync(python, leaseArgs(home, 'simulator.ios', uuid, [process.execPath, '-e', 'process.exit(0)']), { encoding: 'utf8' });
  const before = compete();
  assert.equal(before.status, 2);
  assert.match(before.stderr, /PHYSICAL_RESOURCE_CONFLICT/);
  holder.kill('SIGKILL');
  await exited;
  const after = compete();
  assert.equal(after.status, 2);
  assert.match(after.stderr, /PHYSICAL_RESOURCE_CONFLICT/);
  process.kill(childPid, 'SIGTERM');
  childPid = null;
  // Use an independent bounded probe to establish release; do not infer it
  // from stale metadata or supervisor exit.
  const release = spawnSync(python, ['-c',
    'import fcntl,sys,time\nf=open(sys.argv[1],"r+")\nend=time.monotonic()+3\nwhile True:\n try:\n  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);break\n except BlockingIOError:\n  if time.monotonic()>end: raise\n  time.sleep(.02)',
    machineLeasePath('simulator.ios', uuid, home)], { encoding: 'utf8' });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(compete().status, 0);
});

test('nested slot and physical leases retain both descriptors through the mutation child', (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'pt-nested-lock-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const probe = [
    process.execPath, '-e', `
      const {spawnSync}=require('node:child_process');
      const frames=JSON.parse(process.env.PT_MACHINE_LEASE_STACK_JSON);
      if(frames.length!==2)process.exit(9);
      for(const frame of frames){
        require('node:fs').fstatSync(Number(frame.fd));
        const file=frame.kind==='local.slot'?${JSON.stringify(machineLeasePath('local.slot', '98', home))}:${JSON.stringify(machineLeasePath('simulator.ios', uuid, home))};
        const probe=spawnSync(${JSON.stringify(python)},['-c','import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',file]);
        if(probe.status===0)process.exit(10);
      }`,
  ];
  const inner = [python, ...leaseArgs(home, 'simulator.ios', uuid, probe)];
  const result = spawnSync(python, leaseArgs(home, 'local.slot', '98', inner), { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
