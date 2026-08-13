# P1-M1: Tool Execution Runtime — Acceptance Scenarios

> **Module**: P1-M1 Tool Execution Runtime
> **Step**: S2 (acceptance definition)
> **Coverage**: Every tool execution path + approval variant

---

## AT-01: Auto-approved tool execution (file_read)

**Precondition**: Agent has file_read tool enabled with `approval: auto`
**Steps**:
1. User sends "Read the file at /tmp/test.txt" (file exists with known content)
2. LLM emits tool_call for `file_read` with `{ "path": "/tmp/test.txt" }`
3. Station emits `local_tool_request` event to client
4. Client auto-executes (no user prompt)
5. Client submits result back to Station
6. LLM sees file content, responds to user

**Acceptance**:
- No approval prompt shown in UI
- ToolCallCard shows: tool name, arguments, loading state, then result
- Assistant response references the file content
- **Status**: pending

---

## AT-02: Tool requiring approval (shell)

**Precondition**: Agent has shell tool enabled with `approval: ask`
**Steps**:
1. User sends "Run `ls -la /tmp`"
2. LLM emits tool_call for `shell` with `{ "command": "ls -la /tmp" }`
3. Station emits `local_tool_request`
4. Client shows approval prompt: tool name, command preview, Approve/Deny buttons
5. User clicks Approve
6. Command executes, result submitted

**Acceptance**:
- Approval prompt visible with tool name and arguments
- Approve button triggers execution
- Result displayed in ToolCallCard
- **Status**: pending

---

## AT-03: Tool denied by user

**Precondition**: Same as AT-02
**Steps**:
1-4. Same as AT-02
5. User clicks Deny

**Acceptance**:
- Result submitted as `{ content: "Tool execution denied by user", isError: true }`
- LLM receives denial, responds appropriately (e.g., "I can't execute that command")
- ToolCallCard shows "Denied" status
- **Status**: pending

---

## AT-04: Tool timeout (user doesn't respond)

**Precondition**: Tool with `approval: ask`, user doesn't respond
**Steps**:
1-4. Same as AT-02
5. 110 seconds pass without user action

**Acceptance**:
- Auto-deny fires with timeout message
- ToolCallCard shows "Timed out" status
- Stream continues with LLM handling the timeout
- **Status**: pending

---

## AT-05: Unknown tool (not in registry)

**Precondition**: LLM hallucinates a tool name not in registry
**Steps**:
1. Station emits `local_tool_request` for unknown tool `foo_bar`
2. Client looks up registry → not found

**Acceptance**:
- Client submits `{ content: "Tool 'foo_bar' is not available", isError: true }`
- No crash, no unhandled promise rejection
- **Status**: pending

---

## AT-06: Multiple tool calls in sequence

**Precondition**: Agent has file_read + list_dir both auto-approved
**Steps**:
1. User sends "List the files in /tmp then read the first one"
2. LLM emits tool_call for `list_dir` → result → tool_call for `file_read` → result → final response

**Acceptance**:
- Both tool calls rendered in sequence in the message
- Each shows its own ToolCallCard with name/args/result
- Final assistant response uses both results
- **Status**: pending

---

## AT-07: Tool executor error (file not found)

**Precondition**: file_read tool, file doesn't exist
**Steps**:
1. User sends "Read /tmp/nonexistent.txt"
2. LLM emits tool_call
3. Executor tries to read → file not found

**Acceptance**:
- Result submitted as `{ content: "File not found: /tmp/nonexistent.txt", isError: true }`
- ToolCallCard shows error status (red indicator)
- LLM handles gracefully ("The file doesn't exist")
- **Status**: pending

---

## AT-08: Tool store state management

**Acceptance** (unit test):
- `ToolExecutorRegistry.get(name)` returns executor for registered tools
- `ToolExecutorRegistry.get(unknown)` returns undefined
- Approval service respects per-tool policy from agent config
- **Status**: pending
