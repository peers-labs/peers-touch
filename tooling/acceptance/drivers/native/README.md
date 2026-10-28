# Native Acceptance Drivers

Platform adapters own native input, screenshots and OS observations. Runtime
bindings authorize and isolate a target process before a business Gate uses
these adapters.

`macos_documents.py` owns bounded document scripting, process-scoped window and
content observations, and operations on an exact disposable document path.
The calling Gate owns the file/action identity, verified byte expectations,
allowed transition and final cleanup. These observations do not provision a
client, infer Chat authority or promote missing native evidence to PASS.
