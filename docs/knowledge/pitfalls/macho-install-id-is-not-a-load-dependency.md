---
kind: pitfall
title: Mach-O self-install IDs must not become external dependency paths
status: active
owns:
  - tooling/acceptance/input_owners/installed_inputs.py
  - tooling/acceptance/input_owners/pnpm_toolchain.py
  - tooling/acceptance/tests/test_installed_inputs.py
related:
  - docs/architecture/engineering/acceptance/execution-budget.md
referenced-by: []
detected: 2026-10-25
---

# Mach-O library identity

`otool -L` lists a dynamic library's own `LC_ID_DYLIB` before its load
dependencies. A redistributed native Node module can retain an install ID
from its producer's build directory. That name is part of the image's bytes;
it does not require a second file at the producer path.

Treating every `-L` entry as a dependency makes valid installed native modules
fail identity observation with a missing-file error. Removing all missing
entries instead would grant closure to a genuinely missing dependency.

The installation owner reads `otool -D` for the same resolved image and
excludes only the explicitly reported self-install name. Every actual
non-system load dependency still resolves to an existing file and contributes
its bytes and transitive dependencies. Both inspector operations retain their
original bounded subprocess limits and caller cancellation.

## How to detect a recurrence

Run the real temporary-library regression:

```bash
.local/acceptance/python-venv/bin/python3 -B -m unittest \
  tooling.acceptance.tests.test_installed_inputs.InstalledInputsTest.test_macos_library_inputs_distinguish_self_id_and_actual_dependencies
```

The fixture compiles a client dylib with a nonexistent self-install ID and
one real dependency. The observation must include that dependency's bytes
without reading the self-ID path. Deleting the dependency must still reject.
The test creates no product proof, modifies no installed library and releases
its temporary files on either result.
