// Tiny dependency-free protobuf wire decoder for the headless acceptance
// bridge. Gateway proto responses arrive as base64 ({ proto_b64 }); proto
// stays the single contract (no JSON DTO in product code), so this only maps
// the exact fields each closure asserts, declared from the .proto field
// numbers. It is intentionally not a general-purpose protobuf runtime.
//
// Supported scalar types: v (uint/varint/enum), s32 (signed int32), bool,
// string, bytes (Uint8Array), and nested msg. Repeated fields are arrays.

function readVarint(bytes, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const byte = bytes[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}

function toSigned32(value) {
  const v = BigInt(value) & 0xffffffffn;
  return v >= 0x80000000n ? Number(v - 0x100000000n) : Number(v);
}

function decodeMessage(bytes, schema) {
  const out = {};
  let pos = 0;
  while (pos < bytes.length) {
    let tag;
    [tag, pos] = readVarint(bytes, pos);
    const field = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    const spec = schema?.[field];
    const name = spec?.name ?? `_${field}`;

    if (wireType === 0) {
      let value;
      [value, pos] = readVarint(bytes, pos);
      if (spec?.type === 'bool') value = value !== 0n;
      else if (spec?.type === 's32') value = toSigned32(value);
      else value = Number(value);
      assign(out, name, value, spec);
    } else if (wireType === 2) {
      let length;
      [length, pos] = readVarint(bytes, pos);
      const chunk = bytes.subarray(pos, pos + Number(length));
      pos += Number(length);
      let value;
      if (spec?.type === 'string') {
        value = new TextDecoder().decode(chunk);
      } else if (spec?.type === 'bytes') {
        value = chunk;
      } else if (spec?.type === 'msg') {
        value = decodeMessage(chunk, spec.schema);
      } else {
        // Unknown length-delimited field: keep UTF-8 best effort.
        value = new TextDecoder().decode(chunk);
      }
      assign(out, name, value, spec);
    } else if (wireType === 1) {
      pos += 8; // fixed64, unused in asserted messages
    } else if (wireType === 5) {
      pos += 4; // fixed32, unused in asserted messages
    } else {
      break;
    }
  }
  return out;
}

function assign(target, name, value, spec) {
  if (spec?.repeated) {
    if (!Array.isArray(target[name])) target[name] = [];
    target[name].push(value);
  } else {
    target[name] = value;
  }
}

export const SCHEMAS = {
  TerminalSession: {
    1: { name: 'session_id', type: 'string' },
    2: { name: 'conversation_id', type: 'string' },
    3: { name: 'turn_id', type: 'string' },
    4: { name: 'device_id', type: 'string' },
    5: { name: 'cwd', type: 'string' },
    6: { name: 'command', type: 'string' },
    7: { name: 'args', type: 'string', repeated: true },
    8: { name: 'pid', type: 'v' },
    9: { name: 'status', type: 'v' },
    10: { name: 'exit_code', type: 's32' },
    11: { name: 'output_bytes', type: 'v' },
    14: { name: 'execution_target', type: 'v' },
    15: { name: 'sandbox_ref', type: 'string' },
  },
  ListTerminalSessions: {
    1: { name: 'sessions', type: 'msg', repeated: true, schema: null },
  },
  LogicalArtifact: {
    1: { name: 'artifact_id', type: 'string' },
    2: { name: 'task_id', type: 'string' },
    3: { name: 'conversation_id', type: 'string' },
    4: { name: 'agent_id', type: 'string' },
    5: { name: 'kind', type: 'v' },
    6: { name: 'name', type: 'string' },
    7: { name: 'current_version_id', type: 'string' },
    8: { name: 'current_seq', type: 'v' },
  },
  ArtifactVersion: {
    1: { name: 'version_id', type: 'string' },
    2: { name: 'artifact_id', type: 'string' },
    3: { name: 'seq', type: 'v' },
    4: { name: 'parent_version_id', type: 'string' },
    5: { name: 'origin', type: 'v' },
    6: { name: 'content_type', type: 'string' },
    7: { name: 'sha256', type: 'string' },
    8: { name: 'size', type: 'v' },
    9: { name: 'summary', type: 'string' },
    10: { name: 'source_turn_id', type: 'string' },
    11: { name: 'source_message_id', type: 'string' },
    12: { name: 'feedback_id', type: 'string' },
    13: { name: 'adopted_attachment_refs', type: 'string', repeated: true },
    14: { name: 'created_by', type: 'string' },
    16: { name: 'source_tool_call_id', type: 'string' },
  },
  ArtifactCheck: {
    1: { name: 'check_id', type: 'string' },
    2: { name: 'artifact_id', type: 'string' },
    3: { name: 'version_id', type: 'string' },
    4: { name: 'sha256', type: 'string' },
    5: { name: 'check_type', type: 'v' },
    6: { name: 'result', type: 'v' },
    7: { name: 'detail', type: 'string' },
    13: { name: 'source_tool_call_id', type: 'string' },
    14: { name: 'command', type: 'string' },
    15: { name: 'command_exit_code', type: 's32' },
    16: { name: 'command_output_sha256', type: 'string' },
  },
  ArtifactAcceptance: {
    1: { name: 'acceptance_id', type: 'string' },
    2: { name: 'artifact_id', type: 'string' },
    3: { name: 'version_id', type: 'string' },
    4: { name: 'sha256', type: 'string' },
    5: { name: 'check_ids', type: 'string', repeated: true },
    6: { name: 'actor', type: 'string' },
    8: { name: 'current', type: 'bool' },
  },
  CapabilityDisplayMetadata: {
    1: { name: 'name', type: 'string' },
    2: { name: 'description', type: 'string' },
    3: { name: 'icon_ref', type: 'string' },
  },
  CapabilityManifest: {
    1: { name: 'capability_id', type: 'string' },
    2: { name: 'version', type: 'string' },
    3: { name: 'source_kind', type: 'v' },
    4: { name: 'source_instance_id', type: 'string' },
    5: { name: 'display_metadata', type: 'msg', schema: null },
    6: { name: 'input_schema_ref', type: 'string' },
    7: { name: 'output_schema_ref', type: 'string' },
    8: { name: 'execution_owner', type: 'v' },
    9: { name: 'required_runtime_capabilities', type: 'string', repeated: true },
    10: { name: 'risk_class', type: 'string' },
    11: { name: 'default_approval_policy', type: 'v' },
    12: { name: 'secret_boundary', type: 'string' },
    13: { name: 'availability', type: 'v' },
    18: { name: 'owner_ptid', type: 'string' },
  },
  AgentCapabilityBinding: {
    1: { name: 'binding_id', type: 'string' },
    2: { name: 'ptid', type: 'string' },
    3: { name: 'agent_id', type: 'string' },
    4: { name: 'capability_id', type: 'string' },
    5: { name: 'capability_version', type: 'string' },
    6: { name: 'enabled', type: 'bool' },
    7: { name: 'approval_policy', type: 'v' },
    8: { name: 'expected_agent_version', type: 'v' },
    9: { name: 'revision', type: 'v' },
  },
  CapabilityReadiness: {
    1: { name: 'capability_id', type: 'string' },
    2: { name: 'capability_version', type: 'string' },
    3: { name: 'binding_id', type: 'string' },
    4: { name: 'binding_revision', type: 'v' },
    5: { name: 'state', type: 'v' },
    6: { name: 'authority', type: 'string' },
    7: { name: 'reason_code', type: 'string' },
  },
  CapabilityReadinessSnapshot: {
    1: { name: 'snapshot_id', type: 'string' },
    2: { name: 'ptid', type: 'string' },
    3: { name: 'agent_id', type: 'string' },
    4: { name: 'runtime_snapshot_id', type: 'string' },
    8: { name: 'selected_client_session_id', type: 'string' },
    9: { name: 'capabilities', type: 'msg', repeated: true, schema: null },
  },
};

// Wire nested-message schemas (filled after SCHEMAS declaration to allow
// self/forward references).
SCHEMAS.ListTerminalSessions[1].schema = SCHEMAS.TerminalSession;
SCHEMAS.CapabilityManifest[5].schema = SCHEMAS.CapabilityDisplayMetadata;
SCHEMAS.CapabilityReadinessSnapshot[9].schema = SCHEMAS.CapabilityReadiness;

export const RESPONSE_SCHEMAS = {
  CreateTerminalSession: {
    1: { name: 'session', type: 'msg', schema: SCHEMAS.TerminalSession },
  },
  UpdateTerminalSession: {
    1: { name: 'session', type: 'msg', schema: SCHEMAS.TerminalSession },
  },
  ListTerminalSessions: SCHEMAS.ListTerminalSessions,
  ReconcileTerminalSessions: SCHEMAS.ListTerminalSessions,
  RemoveTerminalSession: { 1: { name: 'removed', type: 'bool' } },
  ClaimArtifactVersion: {
    1: { name: 'artifact', type: 'msg', schema: SCHEMAS.LogicalArtifact },
    2: { name: 'version', type: 'msg', schema: SCHEMAS.ArtifactVersion },
  },
  ListTaskArtifacts: {
    1: { name: 'artifacts', type: 'msg', repeated: true, schema: SCHEMAS.LogicalArtifact },
  },
  ListArtifactVersions: {
    1: { name: 'versions', type: 'msg', repeated: true, schema: SCHEMAS.ArtifactVersion },
  },
  GetArtifactVersionBody: {
    1: { name: 'version', type: 'msg', schema: SCHEMAS.ArtifactVersion },
    2: { name: 'body', type: 'string' },
  },
  RecordArtifactCheck: {
    1: { name: 'check', type: 'msg', schema: SCHEMAS.ArtifactCheck },
  },
  ListArtifactChecks: {
    1: { name: 'checks', type: 'msg', repeated: true, schema: SCHEMAS.ArtifactCheck },
  },
  AcceptArtifactVersion: {
    1: { name: 'acceptance', type: 'msg', schema: SCHEMAS.ArtifactAcceptance },
  },
  ListArtifactAcceptances: {
    1: { name: 'acceptances', type: 'msg', repeated: true, schema: SCHEMAS.ArtifactAcceptance },
  },
  ListCapabilityManifests: {
    1: { name: 'manifests', type: 'msg', repeated: true, schema: SCHEMAS.CapabilityManifest },
  },
  ListAgentCapabilityBindings: {
    1: { name: 'bindings', type: 'msg', repeated: true, schema: SCHEMAS.AgentCapabilityBinding },
  },
  UpsertAgentCapabilityBinding: {
    1: { name: 'binding', type: 'msg', schema: SCHEMAS.AgentCapabilityBinding },
  },
  GetCapabilityReadiness: {
    1: { name: 'snapshot', type: 'msg', schema: SCHEMAS.CapabilityReadinessSnapshot },
  },
};

// Decodes a { proto_b64 } gateway data payload using a named response schema.
export function decodeProtoB64(protoB64, schemaName) {
  const schema = RESPONSE_SCHEMAS[schemaName];
  if (!schema) throw new Error(`unknown proto schema: ${schemaName}`);
  const binary = Uint8Array.from(Buffer.from(protoB64, 'base64'));
  return decodeMessage(binary, schema);
}

// Decodes a gateway data payload delivered as a raw JSON byte array. Several
// capability-authority arms return AppResult<Vec<u8>> directly (prost bytes),
// which tiny_http/serde renders as [u8; N] rather than { proto_b64 }.
export function decodeProtoBytes(byteArray, schemaName) {
  const schema = RESPONSE_SCHEMAS[schemaName];
  if (!schema) throw new Error(`unknown proto schema: ${schemaName}`);
  return decodeMessage(Uint8Array.from(byteArray), schema);
}

// TerminalSessionStatus enum values (terminal_session.proto).
export const TERMINAL_STATUS = {
  UNSPECIFIED: 0,
  RUNNING: 1,
  EXITED: 2,
  KILLED: 3,
  UNKNOWN: 4,
};

// ExecutionTarget enum values (execution_target.proto).
export const EXECUTION_TARGET = {
  UNSPECIFIED: 0,
  DESKTOP_DEVICE: 1,
  WORKSPACE_SANDBOX: 2,
};

// ArtifactVersionOrigin enum values (agent.proto).
export const ARTIFACT_ORIGIN = {
  UNSPECIFIED: 0,
  AGENT_OUTPUT: 1,
  HUMAN_EDIT: 2,
  FEEDBACK_REVISION: 3,
  IMPORT: 4,
};

export const ARTIFACT_KIND = { UNSPECIFIED: 0, DOCUMENT: 1 };
export const ARTIFACT_CHECK_TYPE = { UNSPECIFIED: 0, STRUCTURAL: 1, HUMAN_REVIEW: 2, COMMAND: 3 };
export const ARTIFACT_CHECK_RESULT = { UNSPECIFIED: 0, PASSED: 1, FAILED: 2 };
