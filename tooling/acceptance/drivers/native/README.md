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
Attribute failures preserve status, returned-value presence and elapsed time,
including expiry after the native call; failed values are always released.
Operator focus reads additionally share the original one-second deadline,
including subprocess startup, across both consecutive samples.

`macos.py` shares the exact-PID panel finder between operator observation and
file selection. The prepared Cell qualifies semantic selection with a real
open/select/close and exact file readback before Binding admits it. Window,
status-item and exclusive permission actions retain their own contracts.

`macos_panels.py` reads AppKit file-panel controls through native AXChildren
and presses a button only inside one target process. Its subprocess deadline
bounds unresponsive XPC controls; missing or ambiguous panels fail closed.
