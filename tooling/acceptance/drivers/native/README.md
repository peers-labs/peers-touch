# Native Acceptance Drivers

Platform adapters own native input, screenshots and OS observations. Runtime
bindings authorize and isolate a target process before a business Gate uses
these adapters.

`macos_documents.py` owns bounded document scripting, process-scoped window and
content observations, and operations on an exact disposable document path.
The calling Gate owns the file/action identity, verified byte expectations,
allowed transition and final cleanup. These observations do not provision a
client, infer Chat authority or promote missing native evidence to PASS.

`macos_ax.py` owns the shared AX read deadline, optional absence semantics and
checked one-shot mutations for window, file-selection and panel probes.
Only read-only cannot-complete errors may recover inside one observation's
1.5-second budget. Required window-list failures never mean a panel has closed.

`macos_panels.py` reads AppKit file-panel controls through native AXChildren
and presses a button only inside one target process. Its subprocess deadline
bounds unresponsive XPC controls; missing or ambiguous panels fail closed.
