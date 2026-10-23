---
kind: pitfall
title: A live SSH master does not prove a live remote source lease
status: active
owns:
  - tooling/acceptance/core/lease.py
  - tooling/acceptance/core/provisioner.py
  - tooling/acceptance/transports/ssh.py
  - tooling/scripts/acceptance-run.py
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
detected: 2026-10-23
---

# A live SSH master does not prove a live remote source lease

## Symptom and cause

Repeated SSH authentication consumed real Native Gate preparation time while
remote Docker inspection itself took about 0.03 seconds. OpenSSH reuse reduced
subsequent operations, but a live multiplex master can outlive its original
lease channel while another borrowed command still runs.

## Mitigation

The existing source lease owns a private ControlMaster with no persistence.
Each operation checks the exact target, socket permissions and actual master
PID, then checks the real remote file lock and recorded lease owner before
running its command. A lost master cannot fall back to a new TCP connection.
Runner projects only this Environment's descriptors to parent preparation,
ordinary Gate children and cleanup. Borrowers do not release the master.
Runtime descriptors and socket paths are not evidence or repository artifacts.
Forward processes retain separate ownership so terminating a borrower cannot
leave master-owned forwards behind.

## How to detect a recurrence

Run bounded `test_source_connection`, `test_profile_lease` and
`test_ssh_transport` regressions. A released or differently owned lock must
prevent the command from executing, even if a socket still exists.
Qualify both assigned targets with actual lock contention, fresh child
inheritance, exact target/owner/PID rejection, deliberate lease loss while a
borrowed channel is active, lock reacquisition and removal of all owned
processes and private socket roots. These transport observations remain
supporting evidence; original Native Gates separately own product proof.
