"""Bounded POSIX transport and source capture for isolated D-19 workers.

These helpers own byte/descriptor I/O, not product validation or publication.
The native supervisor must arm the worker's OS timer before calling them.
"""

from __future__ import annotations

import argparse
import array
import builtins
import fcntl
import hashlib
import importlib
import json
import os
import select
import signal
import socket
import stat
import struct
import sys
import time
import types
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator

# Direct `-I -S` execution must not import core.__init__ or use ambient
# sys.path. Build only the fixed sibling-module package rooted at this
# captured bootstrap closure.
if __package__ in (None, ""):
    package_name = "_pt_finalizer_core"
    package = types.ModuleType(package_name)
    package.__path__ = [os.path.dirname(os.path.realpath(__file__))]
    package.__package__ = package_name
    sys.modules[package_name] = package
    __package__ = package_name

from . import finalization_contracts as contracts


STREAM_LIMIT = 2 * 1024 * 1024
DATAGRAM_LIMIT = 4096
CHUNK_LIMIT = 65536
BUNDLE_MAGIC = b"pt-finalizer-bundle-v1"
RUNTIME_BUNDLE_MAGIC = b"pt-finalizer-runtime-bundle-v1"
MANIFEST_LIMIT = 256 * 1024
ENTRY_LIMIT = 8 * 1024 * 1024
BUNDLE_LIMIT = 64 * 1024 * 1024
OUTPUT_LIMIT = 256 * 1024
JSON_DEPTH_LIMIT = 32
JSON_CONTAINER_LIMIT = 4096
BOOTSTRAP_SOURCE_PATHS = contracts.FINALIZER_BOOTSTRAP_SOURCE_PATHS
WORKER_SOURCE_PATH = "tooling/acceptance/core/finalizer_worker.py"


class WorkerIOError(ValueError):
    """A closed-channel, deadline, identity or bounded-input failure."""


class RuntimeIdentityError(WorkerIOError):
    """The executable, bundle, bootstrap or runtime identity is not exact."""


class FinalizerOutputError(WorkerIOError):
    """The business callback returned a non-contract result."""


class DurabilityProfileError(WorkerIOError):
    """The active host/mount/backend does not match qualified authority."""


class ActiveRunError(WorkerIOError):
    """A D-19-aware run still owns its active lease."""


class NativeHelperError(WorkerIOError):
    """The reviewed native maintenance helper failed closed."""


def _wait(fd: int, *, writing: bool, deadline: float) -> None:
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("worker I/O deadline expired")
        try:
            readable, writable, _ = select.select(
                [] if writing else [fd], [fd] if writing else [], [], remaining
            )
        except InterruptedError:
            continue
        if readable or writable:
            return
        raise TimeoutError("worker I/O deadline expired")


class ControlChannel:
    """Exact length framing; a rejected frame permanently closes the socket."""

    def __init__(self, channel: socket.socket):
        if channel.family != socket.AF_UNIX or channel.type != socket.SOCK_STREAM:
            raise WorkerIOError("control channel must be AF_UNIX SOCK_STREAM")
        self.channel = channel
        self.channel.setblocking(False)

    def _read(self, size: int, deadline: float) -> bytes:
        result = bytearray()
        while len(result) < size:
            _wait(self.channel.fileno(), writing=False, deadline=deadline)
            try:
                part = self.channel.recv(min(size - len(result), CHUNK_LIMIT))
            except (BlockingIOError, InterruptedError):
                continue
            if not part:
                raise WorkerIOError("control EOF before complete frame")
            result.extend(part)
        return bytes(result)

    def receive(self, *, deadline: float, **decoder_context: object) -> object:
        try:
            size = struct.unpack(">I", self._read(4, deadline))[0]
            if not 1 <= size <= STREAM_LIMIT:
                raise WorkerIOError("control length exceeds fixed bounds")
            return contracts.supervisor_control_frame_from_bytes(
                self._read(size, deadline), **decoder_context
            )
        except BaseException:
            self.channel.close()
            raise

    def send(self, frame: object, *, deadline: float) -> None:
        try:
            wire = contracts.canonical_json_bytes(frame.to_dict())
            if not 1 <= len(wire) <= STREAM_LIMIT:
                raise WorkerIOError("control length exceeds fixed bounds")
            # Revalidate concrete outbound envelopes; epoch/result correlation
            # belongs to SupervisorSession and its original request.
            if type(frame) is contracts.WorkerResultFrame:
                contracts.WorkerResultFrame(
                    frame.identity, frame.result, frame.frame_digest
                )
            elif type(frame) is contracts.WorkerRequestFrame:
                contracts.WorkerRequestFrame(
                    frame.identity, frame.request, frame.frame_digest
                )
            else:
                contracts.supervisor_control_frame_from_bytes(wire)
            pending = memoryview(struct.pack(">I", len(wire)) + wire)
            while pending:
                _wait(self.channel.fileno(), writing=True, deadline=deadline)
                try:
                    count = self.channel.send(pending[:CHUNK_LIMIT])
                except (BlockingIOError, InterruptedError):
                    continue
                if count == 0:
                    raise WorkerIOError("control channel write made no progress")
                pending = pending[count:]
        except BaseException:
            self.channel.close()
            raise


def validate_directory_descriptor(fd: int, claim: contracts.DescriptorClaim) -> None:
    """Set CLOEXEC first, then check the immutable claim and local permissions."""
    fcntl.fcntl(fd, fcntl.F_SETFD, fcntl.fcntl(fd, fcntl.F_GETFD) | fcntl.FD_CLOEXEC)
    observed = os.fstat(fd)
    if (
        not stat.S_ISDIR(observed.st_mode)
        or str(observed.st_dev) != claim.device_id
        or str(observed.st_ino) != claim.inode
        or observed.st_uid != os.geteuid()
        or observed.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        raise WorkerIOError("directory descriptor identity/owner/permissions mismatch")
    if (
        claim.role is contracts.DescriptorRole.TEMPORARY_DIRECTORY
        and stat.S_IMODE(observed.st_mode) & 0o077
    ):
        raise WorkerIOError("temporary directory must be owner-only")


def _close_descriptors(descriptors: list[int]) -> None:
    for fd in descriptors:
        os.close(fd)


def receive_descriptors(
    channel: socket.socket,
    identity: contracts.WorkerRequestIdentity,
    *,
    deadline: float,
) -> tuple[int, ...]:
    received: list[int] = []
    try:
        if channel.family != socket.AF_UNIX or channel.type != socket.SOCK_DGRAM:
            raise WorkerIOError("descriptor channel must be AF_UNIX SOCK_DGRAM")
        if not identity.descriptor_claims:
            raise WorkerIOError("descriptor-free worker forbids ancillary transfer")
        channel.setblocking(False)
        while True:
            _wait(channel.fileno(), writing=False, deadline=deadline)
            try:
                wire, ancillary, flags, _ = channel.recvmsg(
                    DATAGRAM_LIMIT,
                    socket.CMSG_SPACE(16 * array.array("i").itemsize),
                )
                break
            except (BlockingIOError, InterruptedError):
                continue
        # Collect every installed descriptor before rejecting any envelope shape.
        for level, kind, data in ancillary:
            if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                installed = array.array("i")
                installed.frombytes(data[:len(data) - len(data) % installed.itemsize])
                received.extend(installed)
        for fd in received:
            fcntl.fcntl(fd, fcntl.F_SETFD, fcntl.fcntl(fd, fcntl.F_GETFD) | fcntl.FD_CLOEXEC)
        if (
            flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC)
            or len(ancillary) != 1
            or ancillary[0][:2] != (socket.SOL_SOCKET, socket.SCM_RIGHTS)
            or len(received) != len(identity.descriptor_claims)
        ):
            raise WorkerIOError("descriptor datagram shape/count mismatch")
        contracts.supervisor_scalar_frame_from_bytes(
            wire, ancillary=True, expected_identity=identity
        )
        for fd, claim in zip(received, identity.descriptor_claims, strict=True):
            validate_directory_descriptor(fd, claim)
        return tuple(received)
    except BaseException:
        _close_descriptors(received)
        channel.close()
        raise


class DescriptorSend:
    """Keep sender duplicates until a correlated acceptance or explicit close."""

    def __init__(self, identity: contracts.WorkerRequestIdentity, owner_fds: tuple[int, ...]):
        self.identity = identity
        self.duplicates: list[int] = []
        self.sent = False
        try:
            if not identity.descriptor_claims or len(owner_fds) != len(identity.descriptor_claims):
                raise WorkerIOError("sender descriptors do not match request")
            for fd, claim in zip(owner_fds, identity.descriptor_claims, strict=True):
                duplicate = os.dup(fd)
                self.duplicates.append(duplicate)
                validate_directory_descriptor(duplicate, claim)
        except BaseException:
            self.close()
            raise

    def send(self, channel: socket.socket, *, deadline: float) -> contracts.DescriptorTransferFrame:
        payload = {
            "frameType": "DESCRIPTOR_TRANSFER",
            "identity": self.identity.to_dict(),
            "descriptorClaimDigests": [
                claim.descriptor_claim_digest for claim in self.identity.descriptor_claims
            ],
        }
        frame = contracts.DescriptorTransferFrame(
            self.identity, tuple(payload["descriptorClaimDigests"]),
            contracts.domain_separated_sha256(
                "pt.acceptance.finalization.supervisor-control-frame.v1", payload
            ),
        )
        try:
            if channel.family != socket.AF_UNIX or channel.type != socket.SOCK_DGRAM:
                raise WorkerIOError("descriptor channel must be AF_UNIX SOCK_DGRAM")
            if not self.duplicates:
                raise WorkerIOError("sender descriptors already closed")
            if self.sent:
                raise WorkerIOError("sender descriptors already sent")
            channel.setblocking(False)
            wire = contracts.canonical_json_bytes(frame.to_dict())
            while True:
                _wait(channel.fileno(), writing=True, deadline=deadline)
                try:
                    count = channel.sendmsg(
                        [wire], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", self.duplicates))]
                    )
                    break
                except (BlockingIOError, InterruptedError):
                    continue
            if count != len(wire):
                raise WorkerIOError("partial descriptor datagram send")
            self.sent = True
            return frame
        except BaseException:
            self.close()
            channel.close()
            raise

    def accept(self, frame: contracts.RequestAcceptedFrame) -> None:
        if (
            not self.sent or not self.duplicates
            or type(frame) is not contracts.RequestAcceptedFrame
            or frame.identity != self.identity
        ):
            self.close()
            raise WorkerIOError("acceptance belongs to another descriptor transfer")
        self.close()

    def close(self) -> None:
        descriptors, self.duplicates = self.duplicates, []
        _close_descriptors(descriptors)


@contextmanager
def anchored_file(root_fd: int, path: str) -> Iterator[int]:
    """Walk every directory with no-follow; never use an ambient absolute path."""
    contracts.validate_repo_relative_path(path)
    directory = os.dup(root_fd)
    opened = None
    try:
        for component in path.split("/")[:-1]:
            child = os.open(
                component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory,
            )
            os.close(directory)
            directory = child
            if not stat.S_ISDIR(os.fstat(directory).st_mode):
                raise WorkerIOError("source parent is not a directory")
        opened = os.open(
            path.split("/")[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK,
            dir_fd=directory,
        )
        if not stat.S_ISREG(os.fstat(opened).st_mode):
            raise WorkerIOError("source entry is not a regular file")
        os.close(directory)
        directory = -1
        yield opened
    finally:
        if opened is not None:
            os.close(opened)
        if directory != -1:
            os.close(directory)


@dataclass(frozen=True)
class CapturedSource:
    path: str
    sha256: str
    content: bytes


def capture_sources(
    root_fd: int, inventory: tuple[tuple[str, str], ...], *, deadline: float
) -> tuple[CapturedSource, ...]:
    if not 1 <= len(inventory) <= 64:
        raise WorkerIOError("source inventory exceeds fixed file limit")
    paths = tuple(path for path, _ in inventory)
    if paths != tuple(sorted(set(paths), key=lambda path: path.encode("utf-8"))):
        raise WorkerIOError("source inventory must be unique and sorted")
    result = []
    total = 0
    for path, expected in inventory:
        contracts.validate_sha256(expected)
        with anchored_file(root_fd, path) as fd:
            before = os.fstat(fd)
            if before.st_size > ENTRY_LIMIT or total + before.st_size > BUNDLE_LIMIT:
                raise WorkerIOError("source capture exceeds fixed byte limits")
            content = bytearray()
            while len(content) < before.st_size:
                if time.monotonic() >= deadline:
                    raise TimeoutError("source capture deadline expired")
                part = os.read(fd, min(CHUNK_LIMIT, before.st_size - len(content)))
                if not part:
                    raise WorkerIOError("source entry truncated during capture")
                content.extend(part)
            after = os.fstat(fd)
            if os.read(fd, 1) or (
                before.st_size, before.st_mtime_ns, before.st_ctime_ns
            ) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise WorkerIOError("source entry changed during capture")
        frozen = bytes(content)
        if hashlib.sha256(frozen).hexdigest() != expected:
            raise WorkerIOError("source capture does not match reviewed hash")
        total += len(frozen)
        result.append(CapturedSource(path, expected, frozen))
    return tuple(result)


def encode_source_bundle(sources: tuple[CapturedSource, ...]) -> bytes:
    if not 1 <= len(sources) <= 64:
        raise WorkerIOError("source bundle exceeds file limit")
    paths = tuple(item.path for item in sources)
    if paths != tuple(sorted(set(paths), key=lambda path: path.encode("utf-8"))):
        raise WorkerIOError("bundle entries must be unique and sorted")
    manifest = []
    length = len(BUNDLE_MAGIC) + 8
    for item in sources:
        contracts.validate_repo_relative_path(item.path)
        if len(item.content) > ENTRY_LIMIT or hashlib.sha256(item.content).hexdigest() != item.sha256:
            raise WorkerIOError("bundle entry hash/length mismatch")
        manifest.append({
            "repoRelativePath": item.path, "fileSha256": item.sha256,
            "byteLength": len(item.content),
        })
        length += 8 + len(item.content)
    wire_manifest = contracts.canonical_json_bytes(manifest)
    length += len(wire_manifest)
    if len(wire_manifest) > MANIFEST_LIMIT or length > BUNDLE_LIMIT:
        raise WorkerIOError("bundle exceeds fixed manifest/total limits")
    return b"".join((
        BUNDLE_MAGIC, struct.pack(">Q", len(wire_manifest)), wire_manifest,
        *(part for item in sources for part in (struct.pack(">Q", len(item.content)), item.content)),
    ))


def decode_source_bundle(wire: bytes) -> tuple[CapturedSource, ...]:
    if type(wire) is not bytes or len(wire) > BUNDLE_LIMIT or not wire.startswith(BUNDLE_MAGIC):
        raise WorkerIOError("bundle magic/total length mismatch")
    offset = len(BUNDLE_MAGIC)

    def take(size: int) -> bytes:
        nonlocal offset
        if size > len(wire) - offset:
            raise WorkerIOError("truncated source bundle")
        part = wire[offset:offset + size]
        offset += size
        return part

    size = struct.unpack(">Q", take(8))[0]
    if not 1 <= size <= MANIFEST_LIMIT:
        raise WorkerIOError("bundle manifest exceeds fixed bounds")
    manifest = contracts._strict_json_value(take(size))
    if type(manifest) is not list or not 1 <= len(manifest) <= 64:
        raise WorkerIOError("bundle manifest must contain 1..64 entries")
    sources = []
    for item in manifest:
        if type(item) is not dict or set(item) != {"repoRelativePath", "fileSha256", "byteLength"}:
            raise WorkerIOError("bundle manifest entry is not closed")
        contracts.validate_repo_relative_path(item["repoRelativePath"])
        contracts.validate_sha256(item["fileSha256"])
        declared = item["byteLength"]
        if type(declared) is not int or not 0 <= declared <= ENTRY_LIMIT:
            raise WorkerIOError("bundle entry length exceeds fixed bounds")
        if struct.unpack(">Q", take(8))[0] != declared:
            raise WorkerIOError("bundle entry length differs from manifest")
        content = take(declared)
        if hashlib.sha256(content).hexdigest() != item["fileSha256"]:
            raise WorkerIOError("bundle entry hash differs from manifest")
        sources.append(CapturedSource(item["repoRelativePath"], item["fileSha256"], content))
    if offset != len(wire):
        raise WorkerIOError("source bundle has trailing bytes")
    frozen = tuple(sources)
    if encode_source_bundle(frozen) != wire:
        raise WorkerIOError("source bundle is not canonical")
    return frozen


def _write_capture(
    directory_fd: int,
    name: str,
    content: bytes,
    *,
    byte_limit: int = BUNDLE_LIMIT,
) -> None:
    contracts.validate_repo_relative_path(name)
    if "/" in name or len(content) > byte_limit:
        raise WorkerIOError("capture output name or size exceeds fixed bounds")
    descriptor = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        offset = 0
        while offset < len(content):
            written = os.write(descriptor, content[offset:offset + CHUNK_LIMIT])
            if written <= 0:
                raise WorkerIOError("capture output write made no progress")
            offset += written
        os.fsync(descriptor)
        observed = os.fstat(descriptor)
        if (
            not stat.S_ISREG(observed.st_mode)
            or observed.st_size != len(content)
            or stat.S_IMODE(observed.st_mode) != 0o600
        ):
            raise WorkerIOError("capture output identity differs after durable write")
    except BaseException:
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise
    finally:
        os.close(descriptor)
    os.fsync(directory_fd)


def _worker_result_frame(
    request: contracts.WorkerRequest,
    result: contracts.WorkerResult,
) -> contracts.WorkerResultFrame:
    payload = {
        "frameType": "WORKER_RESULT",
        "identity": request.identity.to_dict(),
        "result": result.to_dict(),
    }
    return contracts.WorkerResultFrame(
        request.identity,
        result,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.supervisor-control-frame.v1", payload
        ),
    )


def _bundle_result(
    request: contracts.PrepareBundleRequest,
    repository_fd: int,
    temporary_fd: int,
    *,
    deadline: float,
) -> contracts.BundlePreparationCompleted:
    sources = capture_sources(repository_fd, request.source_inventory, deadline=deadline)
    expected_entry = request.entrypoint.replace(".", "/") + ".py"
    if expected_entry not in {item.path for item in sources}:
        raise WorkerIOError("bundle entrypoint is absent from reviewed source inventory")
    bundle = encode_source_bundle(sources)
    digest = hashlib.sha256(bundle).hexdigest()
    capture_id = hashlib.sha256(
        b"pt-finalizer-source-capture-v1\x00"
        + request.identity.request_identity_digest.encode("ascii")
        + bytes.fromhex(digest)
    ).hexdigest()
    _write_capture(temporary_fd, f"source-capture-{capture_id}.bundle", bundle)
    payload = {
        "identity": request.identity.to_dict(),
        "status": "COMPLETED",
        "captureId": capture_id,
        "sourceCaptureBundleDigest": digest,
        "expandedInventory": [
            [item.path, item.sha256, len(item.content)] for item in sources
        ],
        "failureCode": None,
        "diagnostic": None,
    }
    return contracts.BundlePreparationCompleted(
        request.identity,
        capture_id,
        digest,
        tuple((item.path, item.sha256, len(item.content)) for item in sources),
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _bundle_failure(
    request: contracts.PrepareBundleRequest, error: BaseException
) -> contracts.BundlePreparationFailed:
    diagnostic = f"{type(error).__name__}: {error}"[:4096]
    if not diagnostic:
        diagnostic = "bundle preparation failed"
    failure_code = (
        contracts.FinalizerFailureCode.TIMED_OUT
        if isinstance(error, TimeoutError)
        else contracts.FinalizerFailureCode.BUNDLE_INVALID
    )
    payload = {
        "identity": request.identity.to_dict(),
        "status": "FAILED",
        "captureId": None,
        "sourceCaptureBundleDigest": None,
        "expandedInventory": [],
        "failureCode": failure_code.value,
        "diagnostic": diagnostic,
    }
    return contracts.BundlePreparationFailed(
        request.identity,
        failure_code,
        diagnostic,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _bounded_json_value(wire: bytes, *, byte_limit: int) -> object:
    if not wire or len(wire) > byte_limit:
        raise WorkerIOError("JSON artifact exceeds finalizer input bound")

    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        if len(pairs) > JSON_CONTAINER_LIMIT:
            raise WorkerIOError("JSON object exceeds member limit")
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise WorkerIOError("JSON artifact contains duplicate object key")
            result[key] = value
        return result

    try:
        value = json.loads(
            wire.decode("utf-8", errors="strict"),
            object_pairs_hook=object_pairs,
            parse_constant=lambda token: (_ for _ in ()).throw(
                WorkerIOError(f"JSON artifact contains invalid number {token}")
            ),
        )
    except (UnicodeError, json.JSONDecodeError) as error:
        raise WorkerIOError("artifact is not valid UTF-8 JSON") from error

    def visit(item: object, depth: int) -> None:
        if depth > JSON_DEPTH_LIMIT:
            raise WorkerIOError("JSON artifact exceeds nesting limit")
        if type(item) is dict:
            if len(item) > JSON_CONTAINER_LIMIT:
                raise WorkerIOError("JSON object exceeds member limit")
            for key, child in item.items():
                if len(key.encode("utf-8")) > byte_limit:
                    raise WorkerIOError("JSON object key exceeds string limit")
                visit(child, depth + 1)
        elif type(item) is list:
            if len(item) > JSON_CONTAINER_LIMIT:
                raise WorkerIOError("JSON array exceeds member limit")
            for child in item:
                visit(child, depth + 1)
        elif type(item) is str and len(item.encode("utf-8")) > byte_limit:
            raise WorkerIOError("JSON string exceeds input limit")
        elif type(item) is int and (
            item < -9007199254740991 or item > 9007199254740991
        ):
            raise WorkerIOError("JSON integer exceeds I-JSON range")

    visit(value, 0)
    return value


def _read_artifact(
    run_fd: int,
    item: contracts.ArtifactMaterializationInput,
    *,
    request: contracts.MaterializeSnapshotRequest,
    cumulative: int,
    deadline: float,
) -> tuple[contracts.SnapshotArtifact, int]:
    with anchored_file(run_fd, item.ref.path) as descriptor:
        before = os.fstat(descriptor)
        if (
            before.st_size > request.single_artifact_byte_limit
            or cumulative + before.st_size > request.cumulative_hash_byte_limit
        ):
            raise WorkerIOError("artifact exceeds materialization hash budget")
        digest = hashlib.sha256()
        payload_bytes = bytearray()
        observed = 0
        while observed < before.st_size:
            if time.monotonic() >= deadline:
                raise TimeoutError("snapshot materialization deadline expired")
            part = os.read(descriptor, min(CHUNK_LIMIT, before.st_size - observed))
            if not part:
                raise WorkerIOError("artifact truncated during materialization")
            observed += len(part)
            digest.update(part)
            if item.payload_kind is contracts.ArtifactPayloadKind.CANONICAL_JSON:
                if observed > request.input_byte_limit:
                    raise WorkerIOError("JSON artifact exceeds finalizer input bound")
                payload_bytes.extend(part)
        after = os.fstat(descriptor)
        if os.read(descriptor, 1) or (
            before.st_size, before.st_mtime_ns, before.st_ctime_ns
        ) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise WorkerIOError("artifact changed during materialization")
    if digest.hexdigest() != item.ref.sha256:
        raise WorkerIOError("artifact content differs from ArtifactRef")
    payload = None
    if item.payload_kind is contracts.ArtifactPayloadKind.CANONICAL_JSON:
        payload = contracts.CanonicalOpaqueJson.from_value(
            schema_id=item.schema_id,
            schema_digest=item.schema_digest,
            value=_bounded_json_value(
                bytes(payload_bytes), byte_limit=request.input_byte_limit
            ),
        )
    return (
        contracts.SnapshotArtifact(
            item.role_name,
            item.discriminator,
            item.ref,
            payload,
            None if payload is None else payload.payload_digest(),
        ),
        cumulative + before.st_size,
    )


def _materialize_result(
    request: contracts.MaterializeSnapshotRequest,
    run_fd: int,
    *,
    deadline: float,
) -> contracts.MaterializeSnapshotCompleted:
    artifacts = []
    cumulative = 0
    for item in request.artifact_inventory:
        artifact, cumulative = _read_artifact(
            run_fd, item, request=request, cumulative=cumulative, deadline=deadline
        )
        artifacts.append(artifact)
    snapshot = contracts.ReadOnlyEvidenceSnapshot.create(
        workspace_id=request.workspace_id,
        gate_id=request.gate_id,
        evidence_run_id=request.evidence_run_id,
        evaluation_time=request.evaluation_time,
        artifacts=tuple(artifacts),
        runtime_manifest_ref=request.runtime_manifest_ref,
        source_commit=request.source_commit,
        workspace_digest=request.workspace_digest,
        canonical_worktree_hash=request.canonical_worktree_hash,
    )
    if len(contracts.canonical_json_bytes(snapshot.to_dict())) > request.input_byte_limit:
        raise WorkerIOError("materialized snapshot exceeds finalizer input bound")
    payload = {
        "identity": request.identity.to_dict(),
        "status": "COMPLETED",
        "snapshot": snapshot.to_dict(),
        "failureCode": None,
        "diagnostic": None,
    }
    return contracts.MaterializeSnapshotCompleted(
        request.identity,
        snapshot,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _materialize_failure(
    request: contracts.MaterializeSnapshotRequest, error: BaseException
) -> contracts.MaterializeSnapshotFailed:
    diagnostic = f"{type(error).__name__}: {error}"[:4096]
    if not diagnostic:
        diagnostic = "snapshot materialization failed"
    failure_code = (
        contracts.FinalizerFailureCode.TIMED_OUT
        if isinstance(error, TimeoutError)
        else contracts.FinalizerFailureCode.MATERIALIZATION_FAILED
    )
    payload = {
        "identity": request.identity.to_dict(),
        "status": "FAILED",
        "snapshot": None,
        "failureCode": failure_code.value,
        "diagnostic": diagnostic,
    }
    return contracts.MaterializeSnapshotFailed(
        request.identity,
        failure_code,
        diagnostic,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


@dataclass(frozen=True)
class CapturedRuntimeContent:
    identity: contracts.CapturedRuntimeFile
    content: bytes


def _capture_runtime_path(
    value: contracts.RuntimePathInput,
    *,
    single_limit: int,
) -> CapturedRuntimeContent:
    path = value.absolute_path
    if os.path.realpath(path) != path:
        raise RuntimeIdentityError("runtime path must already be canonical realpath")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > single_limit:
            raise RuntimeIdentityError("runtime path is not a bounded regular file")
        content = bytearray()
        while len(content) < before.st_size:
            part = os.read(descriptor, min(CHUNK_LIMIT, before.st_size - len(content)))
            if not part:
                raise RuntimeIdentityError("runtime file truncated during capture")
            content.extend(part)
        after = os.fstat(descriptor)
        if os.read(descriptor, 1) or (
            before.st_size, before.st_mtime_ns, before.st_ctime_ns
        ) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise RuntimeIdentityError("runtime file changed during capture")
    finally:
        os.close(descriptor)
    frozen = bytes(content)
    kind = contracts.RuntimeFileKind(value.kind.value)
    return CapturedRuntimeContent(
        contracts.CapturedRuntimeFile.create(
            kind=kind,
            module_name=value.module_name,
            path_hash=value.expected_path_hash,
            file_sha256=hashlib.sha256(frozen).hexdigest(),
            byte_length=len(frozen),
        ),
        frozen,
    )


def _macho_uuid(header_address: int) -> str:
    import ctypes
    import uuid

    header = ctypes.string_at(header_address, 32)
    magic, = struct.unpack_from("<I", header)
    if magic != 0xFEEDFACF:
        raise RuntimeIdentityError("loaded image is not little-endian Mach-O 64")
    command_count, command_bytes = struct.unpack_from("<II", header, 16)
    if command_count > 65536 or command_bytes > 64 * 1024 * 1024:
        raise RuntimeIdentityError("loaded image command table exceeds bounds")
    commands = ctypes.string_at(header_address + 32, command_bytes)
    offset = 0
    result = None
    for _ in range(command_count):
        if offset + 8 > len(commands):
            raise RuntimeIdentityError("loaded image command table is truncated")
        command, size = struct.unpack_from("<II", commands, offset)
        if size < 8 or offset + size > len(commands):
            raise RuntimeIdentityError("loaded image command has invalid size")
        if command == 0x1B:
            if size < 24 or result is not None:
                raise RuntimeIdentityError("loaded image has invalid UUID command")
            result = str(uuid.UUID(bytes=commands[offset + 8:offset + 24])).upper()
        offset += size
    if offset != len(commands) or result is None:
        raise RuntimeIdentityError("loaded image lacks canonical Mach-O UUID")
    return result


def _darwin_platform_capture(
    *,
    single_limit: int,
) -> tuple[
    contracts.PreflightRuntimePlatformAttestation,
    tuple[CapturedRuntimeContent, ...],
]:
    import ctypes
    import plistlib
    import uuid

    dyld = ctypes.CDLL(None)
    dyld._dyld_image_count.restype = ctypes.c_uint32
    dyld._dyld_get_image_name.argtypes = [ctypes.c_uint32]
    dyld._dyld_get_image_name.restype = ctypes.c_char_p
    dyld._dyld_get_image_header.argtypes = [ctypes.c_uint32]
    dyld._dyld_get_image_header.restype = ctypes.c_void_p
    dyld._dyld_shared_cache_contains_path.argtypes = [ctypes.c_char_p]
    dyld._dyld_shared_cache_contains_path.restype = ctypes.c_bool
    cache_uuid_bytes = (ctypes.c_ubyte * 16)()
    dyld._dyld_get_shared_cache_uuid.argtypes = [ctypes.POINTER(ctypes.c_ubyte)]
    dyld._dyld_get_shared_cache_uuid.restype = ctypes.c_bool
    if not dyld._dyld_get_shared_cache_uuid(cache_uuid_bytes):
        raise RuntimeIdentityError("dyld did not expose shared-cache UUID")
    cache_uuid = str(uuid.UUID(bytes=bytes(cache_uuid_bytes))).upper()

    observed_paths: dict[str, int | None] = {"/usr/lib/dyld": None}
    for index in range(dyld._dyld_image_count()):
        raw = dyld._dyld_get_image_name(index)
        header = dyld._dyld_get_image_header(index)
        if not raw or not header:
            raise RuntimeIdentityError("dyld returned incomplete image identity")
        path = raw.decode("utf-8", errors="strict")
        if not path.startswith("/") or "\x00" in path:
            raise RuntimeIdentityError("dyld returned noncanonical image path")
        observed_paths[path] = int(header)

    identities = []
    standalone = []
    for path in sorted(observed_paths, key=lambda item: item.encode("utf-8")):
        path_hash = contracts.raw_sha256(path.encode("utf-8"))
        logical_name = (
            "dynamic-loader"
            if path == "/usr/lib/dyld"
            else f"{os.path.basename(path)}-{path_hash[:12]}"
        )
        raw_path = path.encode("utf-8")
        in_cache = path != "/usr/lib/dyld" and bool(
            dyld._dyld_shared_cache_contains_path(raw_path)
        )
        if in_cache:
            identity = contracts.PreflightLoadedRuntimeImage.create(
                logical_name=logical_name,
                origin_kind=contracts.RuntimeImageOriginKind.DARWIN_SHARED_CACHE,
                path_hash=path_hash,
                macho_uuid=_macho_uuid(observed_paths[path]),
                code_directory_hash=None,
                shared_cache_uuid=cache_uuid,
            )
        else:
            runtime_path = contracts.RuntimePathInput(
                contracts.RuntimePathKind.PYTHON_EXECUTABLE,
                None,
                path,
                path_hash,
            )
            captured = _capture_runtime_path(runtime_path, single_limit=single_limit)
            image_file = contracts.CapturedRuntimeFile.create(
                kind=contracts.RuntimeFileKind.LOADED_RUNTIME_IMAGE,
                logical_name=logical_name,
                origin_kind=contracts.RuntimeImageOriginKind.STANDALONE_FILE,
                path_hash=path_hash,
                file_sha256=captured.identity.file_sha256,
                byte_length=captured.identity.byte_length,
            )
            standalone.append(CapturedRuntimeContent(image_file, captured.content))
            identity = contracts.PreflightLoadedRuntimeImage.create(
                logical_name=logical_name,
                origin_kind=contracts.RuntimeImageOriginKind.STANDALONE_FILE,
                path_hash=path_hash,
                file_sha256=image_file.file_sha256,
            )
        identities.append(identity)
    identities = sorted(identities, key=lambda item: item.identity_key)
    loader = next(
        item for item in identities if item.logical_name == "dynamic-loader"
    )
    with open(
        "/System/Library/CoreServices/SystemVersion.plist", "rb"
    ) as source:
        system = plistlib.load(source)
    uname = os.uname()
    host = contracts.DarwinRuntimeHostBuild.create(
        product_version=system["ProductVersion"],
        product_build_version=system["ProductBuildVersion"],
        kernel_release=uname.release,
        kernel_version=uname.version,
    )
    platform = contracts.PreflightRuntimePlatformAttestation.create(
        os_family=contracts.RuntimeOsFamily.DARWIN,
        host_build=host,
        dynamic_loader_identity=loader,
        shared_cache_uuid=cache_uuid,
        loaded_images=tuple(identities),
    )
    return platform, tuple(standalone)


def _linux_platform_capture(
    *,
    single_limit: int,
) -> tuple[
    contracts.PreflightRuntimePlatformAttestation,
    tuple[CapturedRuntimeContent, ...],
]:
    paths = set()
    with open("/proc/self/maps", "r", encoding="utf-8") as source:
        for line in source:
            fields = line.rstrip("\n").split(maxsplit=5)
            if len(fields) == 6 and fields[5].startswith("/"):
                path = fields[5]
                if path.endswith(" (deleted)"):
                    raise RuntimeIdentityError("loaded image was deleted during capture")
                paths.add(os.path.realpath(path))
    identities = []
    standalone = []
    for path in sorted(paths, key=lambda item: item.encode("utf-8")):
        path_hash = contracts.raw_sha256(path.encode("utf-8"))
        basename = os.path.basename(path)
        logical_name = (
            "dynamic-loader"
            if basename.startswith(("ld-linux", "ld-musl"))
            else f"{basename}-{path_hash[:12]}"
        )
        runtime_path = contracts.RuntimePathInput(
            contracts.RuntimePathKind.PYTHON_EXECUTABLE,
            None,
            path,
            path_hash,
        )
        captured = _capture_runtime_path(runtime_path, single_limit=single_limit)
        image_file = contracts.CapturedRuntimeFile.create(
            kind=contracts.RuntimeFileKind.LOADED_RUNTIME_IMAGE,
            logical_name=logical_name,
            origin_kind=contracts.RuntimeImageOriginKind.STANDALONE_FILE,
            path_hash=path_hash,
            file_sha256=captured.identity.file_sha256,
            byte_length=captured.identity.byte_length,
        )
        standalone.append(CapturedRuntimeContent(image_file, captured.content))
        identities.append(contracts.PreflightLoadedRuntimeImage.create(
            logical_name=logical_name,
            origin_kind=contracts.RuntimeImageOriginKind.STANDALONE_FILE,
            path_hash=path_hash,
            file_sha256=image_file.file_sha256,
        ))
    identities = sorted(identities, key=lambda item: item.identity_key)
    loaders = [item for item in identities if item.logical_name == "dynamic-loader"]
    if len(loaders) != 1:
        raise RuntimeIdentityError("Linux loader inventory is not singular")
    uname = os.uname()
    os_release = _file_sha256("/etc/os-release")
    platform = contracts.PreflightRuntimePlatformAttestation.create(
        os_family=contracts.RuntimeOsFamily.LINUX,
        host_build=contracts.LinuxRuntimeHostBuild.create(
            os_release_file_sha256=os_release,
            kernel_release=uname.release,
            kernel_version=uname.version,
            machine=uname.machine,
        ),
        dynamic_loader_identity=loaders[0],
        shared_cache_uuid=None,
        loaded_images=tuple(identities),
    )
    return platform, tuple(standalone)


def _encode_runtime_bundle(
    capture_id: str,
    measurement: contracts.PreflightRuntimeMeasurement,
    files: tuple[CapturedRuntimeContent, ...],
) -> bytes:
    ordered = tuple(sorted(files, key=lambda item: item.identity.identity_key))
    manifest = contracts.canonical_json_bytes({
        "captureId": capture_id,
        "measurement": measurement.to_dict(),
        "files": [item.identity.to_dict() for item in ordered],
    })
    if len(manifest) > MANIFEST_LIMIT:
        raise RuntimeIdentityError("runtime capture manifest exceeds fixed bound")
    return b"".join((
        RUNTIME_BUNDLE_MAGIC,
        struct.pack(">Q", len(manifest)),
        manifest,
        *(part for item in ordered for part in (
            struct.pack(">Q", len(item.content)), item.content
        )),
    ))


def _decode_runtime_bundle(
    wire: bytes,
) -> tuple[
    str,
    contracts.PreflightRuntimeMeasurement,
    tuple[CapturedRuntimeContent, ...],
]:
    if (
        type(wire) is not bytes
        or len(wire) > 512 * 1024 * 1024
        or not wire.startswith(RUNTIME_BUNDLE_MAGIC)
    ):
        raise RuntimeIdentityError(
            "runtime bundle magic or total length is invalid"
        )
    offset = len(RUNTIME_BUNDLE_MAGIC)

    def take(size: int) -> bytes:
        nonlocal offset
        if size < 0 or size > len(wire) - offset:
            raise RuntimeIdentityError("runtime bundle is truncated")
        part = wire[offset : offset + size]
        offset += size
        return part

    manifest_length = struct.unpack(">Q", take(8))[0]
    if not 1 <= manifest_length <= MANIFEST_LIMIT:
        raise RuntimeIdentityError(
            "runtime bundle manifest exceeds fixed bounds"
        )
    manifest = contracts._strict_json_value(take(manifest_length))
    if (
        type(manifest) is not dict
        or set(manifest) != {"captureId", "measurement", "files"}
        or type(manifest["files"]) is not list
        or not 3 <= len(manifest["files"]) <= 1024
    ):
        raise RuntimeIdentityError("runtime bundle manifest is not closed")
    capture_id = manifest["captureId"]
    if type(capture_id) is not str or not capture_id:
        raise RuntimeIdentityError("runtime bundle captureId is invalid")
    measurement = contracts.PreflightRuntimeMeasurement.from_dict(
        manifest["measurement"]
    )
    result = []
    cumulative = 0
    for value in manifest["files"]:
        identity = contracts.CapturedRuntimeFile.from_dict(value)
        declared = struct.unpack(">Q", take(8))[0]
        if (
            declared != identity.byte_length
            or declared > 256 * 1024 * 1024
            or cumulative + declared > 512 * 1024 * 1024
        ):
            raise RuntimeIdentityError(
                "runtime bundle file length exceeds fixed bounds"
            )
        content = take(declared)
        if hashlib.sha256(content).hexdigest() != identity.file_sha256:
            raise RuntimeIdentityError("runtime bundle file hash mismatch")
        cumulative += declared
        result.append(CapturedRuntimeContent(identity, content))
    if offset != len(wire):
        raise RuntimeIdentityError("runtime bundle has trailing bytes")
    frozen = tuple(result)
    contracts._validate_runtime_capture_files(
        measurement,
        tuple(item.identity for item in frozen),
    )
    if _encode_runtime_bundle(capture_id, measurement, frozen) != wire:
        raise RuntimeIdentityError("runtime bundle is not canonical")
    return capture_id, measurement, frozen


def _verify_preflight_stdlib(request: contracts.CaptureRuntimeRequest) -> None:
    paths = {
        item.module_name: item
        for item in request.runtime_paths
        if item.kind is contracts.RuntimePathKind.STDLIB_MODULE
    }
    for expected in request.measurement_basis.stdlib_modules:
        module = importlib.import_module(expected.module_name)
        origin = getattr(getattr(module, "__spec__", None), "origin", None)
        if expected.origin_kind is contracts.StdlibModuleOriginKind.BUILTIN:
            if origin != "built-in":
                raise RuntimeIdentityError("stdlib builtin origin mismatch")
        elif expected.origin_kind is contracts.StdlibModuleOriginKind.FROZEN:
            if origin != "frozen":
                raise RuntimeIdentityError("stdlib frozen origin mismatch")
        else:
            if type(origin) is not str or os.path.realpath(origin) != paths[
                expected.module_name
            ].absolute_path:
                raise RuntimeIdentityError("stdlib FILE origin mismatch")
            if _file_sha256(os.path.realpath(origin)) != expected.file_sha256:
                raise RuntimeIdentityError("stdlib FILE hash mismatch")


def _verify_allocated_stdlib(
    runtime: contracts.FinalizerRuntimeIdentity,
) -> None:
    for expected in runtime.stdlib_modules:
        module = importlib.import_module(expected.module_name)
        origin = getattr(getattr(module, "__spec__", None), "origin", None)
        if expected.origin_kind is contracts.StdlibModuleOriginKind.BUILTIN:
            if origin != "built-in":
                raise RuntimeIdentityError("runtime builtin stdlib origin mismatch")
        elif expected.origin_kind is contracts.StdlibModuleOriginKind.FROZEN:
            if origin != "frozen":
                raise RuntimeIdentityError("runtime frozen stdlib origin mismatch")
        else:
            if (
                type(origin) is not str
                or "site-packages" in origin
                or "dist-packages" in origin
                or _file_sha256(os.path.realpath(origin)) != expected.file_sha256
            ):
                raise RuntimeIdentityError("runtime FILE stdlib hash mismatch")


def _preflight_platform_projection(
    runtime: contracts.RuntimePlatformAttestation,
) -> contracts.PreflightRuntimePlatformAttestation:
    images = tuple(
        contracts.PreflightLoadedRuntimeImage.create(
            logical_name=item.logical_name,
            origin_kind=item.origin_kind,
            path_hash=item.path_hash,
            file_sha256=item.file_sha256,
            macho_uuid=item.macho_uuid,
            code_directory_hash=item.code_directory_hash,
            shared_cache_uuid=item.shared_cache_uuid,
        )
        for item in runtime.loaded_images
    )
    loader = next(
        item for item in images if item.logical_name == "dynamic-loader"
    )
    return contracts.PreflightRuntimePlatformAttestation.create(
        os_family=runtime.os_family,
        host_build=runtime.host_build,
        dynamic_loader_identity=loader,
        shared_cache_uuid=runtime.shared_cache_uuid,
        loaded_images=images,
    )


def _runtime_capture_result(
    request: contracts.CaptureRuntimeRequest,
    temporary_fd: int,
) -> contracts.CaptureRuntimeCompleted:
    captured = tuple(
        _capture_runtime_path(
            item, single_limit=request.single_file_byte_limit
        )
        for item in request.runtime_paths
    )
    _verify_preflight_stdlib(request)
    platform, images = (
        _darwin_platform_capture(single_limit=request.single_file_byte_limit)
        if sys.platform == "darwin"
        else _linux_platform_capture(single_limit=request.single_file_byte_limit)
        if sys.platform.startswith("linux")
        else (_ for _ in ()).throw(
            RuntimeIdentityError("runtime capture supports Darwin and Linux only")
        )
    )
    files = tuple(sorted((*captured, *images), key=lambda item: item.identity.identity_key))
    if (
        len(files) > request.file_limit
        or sum(len(item.content) for item in files) > request.cumulative_byte_limit
    ):
        raise RuntimeIdentityError("runtime capture exceeds file/cumulative bound")
    by_kind = {
        item.identity.kind: item.identity
        for item in captured if item.identity.module_name is None
    }
    basis = request.measurement_basis
    import platform as platform_module
    measurement = contracts.PreflightRuntimeMeasurement.create(
        supervisor_source_path=basis.supervisor_source_path,
        supervisor_source_file_sha256=basis.supervisor_source_file_sha256,
        supervisor_binary_sha256=by_kind[
            contracts.RuntimeFileKind.SUPERVISOR_BINARY
        ].file_sha256,
        supervisor_build_identity=basis.supervisor_build_identity,
        executable_path_hash=by_kind[
            contracts.RuntimeFileKind.PYTHON_EXECUTABLE
        ].path_hash,
        executable_sha256=by_kind[
            contracts.RuntimeFileKind.PYTHON_EXECUTABLE
        ].file_sha256,
        implementation=platform_module.python_implementation(),
        version=platform_module.python_version(),
        stdlib_modules=basis.stdlib_modules,
        platform_runtime=platform,
        core_bootstrap_source_digest=basis.core_bootstrap_source_digest,
    )
    measurement.validate_runtime_paths(request.runtime_paths)
    capture_id = hashlib.sha256(
        b"pt-finalizer-runtime-capture-v1\x00"
        + request.identity.request_identity_digest.encode("ascii")
    ).hexdigest()
    bundle = _encode_runtime_bundle(capture_id, measurement, files)
    bundle_digest = hashlib.sha256(bundle).hexdigest()
    _write_capture(
        temporary_fd,
        f"runtime-capture-{capture_id}.bundle",
        bundle,
        byte_limit=request.cumulative_byte_limit + MANIFEST_LIMIT + 1024,
    )
    capture_payload = {
        "captureId": capture_id,
        "measurement": measurement.to_dict(),
        "files": [item.identity.to_dict() for item in files],
        "runtimeCaptureBundleDigest": bundle_digest,
    }
    result_payload = {
        "identity": request.identity.to_dict(),
        "status": "COMPLETED",
        **capture_payload,
        "runtimeCaptureDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.runtime-capture.v1", capture_payload
        ),
        "failureCode": None,
        "diagnostic": None,
    }
    return contracts.CaptureRuntimeCompleted(
        request.identity,
        capture_id,
        measurement,
        tuple(item.identity for item in files),
        bundle_digest,
        result_payload["runtimeCaptureDigest"],
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", result_payload
        ),
    )


def _runtime_capture_failure(
    request: contracts.CaptureRuntimeRequest, error: BaseException
) -> contracts.CaptureRuntimeFailed:
    diagnostic = f"{type(error).__name__}: {error}"[:4096] or "runtime capture failed"
    code = (
        contracts.FinalizerFailureCode.TIMED_OUT
        if isinstance(error, TimeoutError)
        else contracts.FinalizerFailureCode.RUNTIME_MISMATCH
    )
    payload = {
        "identity": request.identity.to_dict(),
        "status": "FAILED",
        "captureId": None,
        "measurement": None,
        "files": [],
        "runtimeCaptureBundleDigest": None,
        "runtimeCaptureDigest": None,
        "failureCode": code.value,
        "diagnostic": diagnostic,
    }
    return contracts.CaptureRuntimeFailed(
        request.identity,
        code,
        diagnostic,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _capture_expanded_bundle(
    executable: contracts.FinalizerExecutableArtifact, *, deadline: float
) -> tuple[str, tuple[CapturedSource, ...]]:
    worker_path = os.path.realpath(__file__)
    root = worker_path
    for _ in WORKER_SOURCE_PATH.split("/"):
        root = os.path.dirname(root)
    if os.path.join(root, *WORKER_SOURCE_PATH.split("/")) != worker_path:
        raise RuntimeIdentityError("worker path is outside the fixed bootstrap layout")
    inventory = executable.files
    inventory_paths = tuple(path for path, _ in inventory)
    if not set(BOOTSTRAP_SOURCE_PATHS).issubset(inventory_paths):
        raise RuntimeIdentityError("finalizer bundle omits fixed bootstrap sources")
    root_fd = os.open(
        root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    try:
        sources = capture_sources(root_fd, inventory, deadline=deadline)
    finally:
        os.close(root_fd)
    if hashlib.sha256(encode_source_bundle(sources)).hexdigest() != executable.bundle_digest:
        raise RuntimeIdentityError("expanded finalizer bundle differs from persisted bundle")
    by_path = {item.path: item for item in sources}
    core_inventory = [
        [path, by_path[path].sha256] for path in BOOTSTRAP_SOURCE_PATHS
    ]
    expected_core = contracts.domain_separated_sha256(
        "pt.acceptance.finalization.core-bootstrap-source.v1", core_inventory
    )
    if expected_core != executable.core_bootstrap_source_digest:
        raise RuntimeIdentityError("expanded core bootstrap digest mismatch")
    business_inventory = [
        [item.path, item.sha256]
        for item in sources if item.path not in BOOTSTRAP_SOURCE_PATHS
    ]
    if not business_inventory or contracts.domain_separated_sha256(
        "pt.acceptance.finalization.source.v1", business_inventory
    ) != executable.source_digest:
        raise RuntimeIdentityError("expanded business source digest mismatch")
    entrypoint_path = executable.entrypoint.replace(".", "/") + ".py"
    if entrypoint_path not in by_path:
        raise RuntimeIdentityError("expanded bundle omits finalizer entrypoint")
    return root, sources


def _verify_finalizer_runtime(
    request: contracts.ExecuteFinalizerRequest,
    *,
    supervisor_session_id: str,
    supervisor_runtime_digest: str,
    bundle_root: str,
) -> None:
    invocation = request.input.invocation
    runtime = invocation.finalizer_runtime
    if (
        invocation.supervisor_session_id != supervisor_session_id
        or request.identity.supervisor_session_id != supervisor_session_id
        or invocation.supervisor_runtime_digest != supervisor_runtime_digest
        or runtime.supervisor_runtime_digest != supervisor_runtime_digest
    ):
        raise RuntimeIdentityError("finalizer supervisor identity mismatch")
    executable = os.path.realpath(sys.executable)
    if (
        contracts.raw_sha256(executable.encode("utf-8")) != runtime.executable_path_hash
        or _file_sha256(executable) != runtime.executable_sha256
    ):
        raise RuntimeIdentityError("running Python executable differs from runtime identity")
    if invocation.finalizer_executable.core_bootstrap_source_digest != (
        runtime.core_bootstrap_source_digest
    ):
        raise RuntimeIdentityError("finalizer bootstrap/runtime identity mismatch")
    _verify_allocated_stdlib(runtime)
    live_platform, _ = (
        _darwin_platform_capture(single_limit=256 * 1024 * 1024)
        if sys.platform == "darwin"
        else _linux_platform_capture(single_limit=256 * 1024 * 1024)
        if sys.platform.startswith("linux")
        else (_ for _ in ()).throw(
            RuntimeIdentityError("finalizer runtime supports Darwin and Linux only")
        )
    )
    if live_platform != _preflight_platform_projection(runtime.platform_runtime):
        raise RuntimeIdentityError("live loaded-image/host identity differs from runtime")
    if os.path.realpath(os.getcwd()) == os.path.realpath(bundle_root):
        raise RuntimeIdentityError("finalizer cwd must be isolated from executable bundle")


def _file_sha256(path: str) -> str:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    digest = hashlib.sha256()
    try:
        while part := os.read(descriptor, CHUNK_LIMIT):
            digest.update(part)
    finally:
        os.close(descriptor)
    return digest.hexdigest()


def _deny_business_capabilities(
    request: contracts.ExecuteFinalizerRequest,
    bundle_root: str,
) -> None:
    def denied(*_args: object, **_kwargs: object) -> object:
        raise WorkerIOError("business finalizer attempted a forbidden capability")

    for name in (
        "fork", "forkpty", "posix_spawn", "posix_spawnp", "setsid",
        "setpgid", "system",
    ):
        if hasattr(os, name):
            setattr(os, name, denied)
    socket.socket = denied
    signal.signal = denied
    signal.setitimer = denied
    signal.alarm = denied

    executable = request.input.invocation.finalizer_executable
    captured_modules = {
        path[:-3].replace("/", ".")
        for path, _ in executable.files if path.endswith(".py")
    }
    package_names = {
        ".".join(module.split(".")[:depth])
        for module in captured_modules
        for depth in range(1, len(module.split(".")) + 1)
    }
    stdlib_names = {
        item.module_name
        for item in request.input.invocation.finalizer_runtime.stdlib_modules
    }
    forbidden_roots = {
        "asyncio", "builtins", "ctypes", "http", "importlib",
        "multiprocessing", "os", "resource", "selectors", "signal", "socket",
        "ssl", "subprocess", "sys", "urllib",
    }
    original_import = builtins.__import__

    def guarded_import(
        name: str,
        globals: dict[str, object] | None = None,
        locals: dict[str, object] | None = None,
        fromlist: tuple[str, ...] = (),
        level: int = 0,
    ) -> object:
        absolute = name
        if level and globals and type(globals.get("__package__")) is str:
            absolute = importlib.util.resolve_name("." * level + name, globals["__package__"])
        root = absolute.split(".", 1)[0]
        allowed = (
            absolute in package_names
            or any(absolute == item or absolute.startswith(item + ".") for item in stdlib_names)
            or absolute in sys.modules
        )
        if root in forbidden_roots or not allowed:
            raise WorkerIOError(f"business finalizer import is not allowlisted: {absolute}")
        return original_import(name, globals, locals, fromlist, level)

    builtins.__import__ = guarded_import
    original_path = tuple(sys.path)
    stdlib_paths = tuple(
        path for path in original_path
        if path and "site-packages" not in path and "dist-packages" not in path
    )
    sys.path[:] = [bundle_root, *stdlib_paths]


def _execute_finalizer_result(
    request: contracts.ExecuteFinalizerRequest,
    *,
    supervisor_session_id: str,
    supervisor_runtime_digest: str,
    deadline: float,
) -> contracts.ExecuteFinalizerCompleted:
    bundle_root, _ = _capture_expanded_bundle(
        request.input.invocation.finalizer_executable, deadline=deadline
    )
    _verify_finalizer_runtime(
        request,
        supervisor_session_id=supervisor_session_id,
        supervisor_runtime_digest=supervisor_runtime_digest,
        bundle_root=bundle_root,
    )
    loaded_before = set(sys.modules)
    _deny_business_capabilities(request, bundle_root)
    module = importlib.import_module(request.input.invocation.finalizer_executable.entrypoint)
    callback = getattr(module, "build_child_outcome", None)
    if not callable(callback):
        raise RuntimeIdentityError(
            "finalizer entrypoint must export build_child_outcome"
        )
    raw_outcome = callback(request.input.to_dict())
    try:
        wire = contracts.canonical_json_bytes(raw_outcome)
        if len(wire) > OUTPUT_LIMIT:
            raise OverflowError("finalizer child outcome exceeds output limit")
        outcome = contracts.FinalizerChildOutcome.from_dict(raw_outcome)
    except OverflowError:
        raise
    except (TypeError, ValueError) as error:
        raise FinalizerOutputError("finalizer child outcome is invalid") from error
    for name in set(sys.modules) - loaded_before:
        loaded = sys.modules[name]
        origin = getattr(loaded, "__file__", None)
        if origin is None:
            continue
        real = os.path.realpath(origin)
        if real.endswith((".so", ".dylib", ".pyd")):
            raise WorkerIOError("business finalizer loaded a native extension")
        if not (
            real == bundle_root
            or real.startswith(bundle_root + os.sep)
            or "site-packages" not in real and "dist-packages" not in real
        ):
            raise WorkerIOError("business finalizer loaded an unbound module")
    if signal.getsignal(signal.SIGALRM) != signal.SIG_DFL:
        raise WorkerIOError("business finalizer replaced the hard timer")
    remaining, interval = signal.getitimer(signal.ITIMER_REAL)
    if remaining <= 0 or interval:
        raise WorkerIOError("business finalizer mutated the hard timer")
    payload = {
        "identity": request.identity.to_dict(),
        "status": "COMPLETED",
        "childOutcome": outcome.to_dict(),
        "failureCode": None,
        "diagnostic": None,
    }
    return contracts.ExecuteFinalizerCompleted(
        request.identity,
        outcome,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _execute_finalizer_failure(
    request: contracts.ExecuteFinalizerRequest,
    error: BaseException,
) -> contracts.ExecuteFinalizerFailed:
    if isinstance(error, TimeoutError):
        code = contracts.FinalizerFailureCode.TIMED_OUT
    elif isinstance(error, OverflowError):
        code = contracts.FinalizerFailureCode.OUTPUT_TOO_LARGE
    elif isinstance(error, FinalizerOutputError):
        code = contracts.FinalizerFailureCode.OUTPUT_INVALID
    elif isinstance(error, RuntimeIdentityError):
        code = contracts.FinalizerFailureCode.RUNTIME_MISMATCH
    else:
        code = contracts.FinalizerFailureCode.PROCESS_FAILED
    diagnostic = f"{type(error).__name__}: {error}"[:4096] or "finalizer failed"
    payload = {
        "identity": request.identity.to_dict(),
        "status": "FAILED",
        "childOutcome": None,
        "failureCode": code.value,
        "diagnostic": diagnostic,
    }
    return contracts.ExecuteFinalizerFailed(
        request.identity,
        code,
        diagnostic,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    )


def _read_anchored_bytes(
    root_fd: int,
    path: str,
    *,
    byte_limit: int,
    deadline: float,
) -> bytes:
    with anchored_file(root_fd, path) as descriptor:
        observed = os.fstat(descriptor)
        if observed.st_size > byte_limit:
            raise OverflowError("anchored file exceeds byte limit")
        result = bytearray()
        while len(result) < observed.st_size:
            if time.monotonic() >= deadline:
                raise TimeoutError("anchored read deadline expired")
            chunk = os.read(
                descriptor,
                min(CHUNK_LIMIT, observed.st_size - len(result)),
            )
            if not chunk:
                raise WorkerIOError("anchored file truncated during read")
            result.extend(chunk)
        if os.read(descriptor, 1):
            raise WorkerIOError("anchored file grew during read")
        return bytes(result)


def _open_or_create_directory_at(parent_fd: int, name: str) -> int:
    contracts.validate_finalizer_id(name)
    try:
        os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        os.fsync(parent_fd)
    except FileExistsError:
        pass
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=parent_fd,
    )
    observed = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(observed.st_mode)
        or observed.st_uid != os.geteuid()
        or observed.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        os.close(descriptor)
        raise WorkerIOError("authority runtime directory is not owner-controlled")
    return descriptor


def _read_regular_at(directory_fd: int, name: str) -> bytes:
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_fd,
    )
    try:
        observed = os.fstat(descriptor)
        if not stat.S_ISREG(observed.st_mode):
            raise WorkerIOError("authority runtime object is not regular")
        result = bytearray()
        while len(result) < observed.st_size:
            chunk = os.read(
                descriptor,
                min(CHUNK_LIMIT, observed.st_size - len(result)),
            )
            if not chunk:
                raise WorkerIOError("authority runtime object is truncated")
            result.extend(chunk)
        if os.read(descriptor, 1):
            raise WorkerIOError("authority runtime object grew during read")
        return bytes(result)
    finally:
        os.close(descriptor)


def _sync_regular_file(
    descriptor: int,
    profile: contracts.ProofAuthorityDurabilityProfile,
) -> None:
    if profile.os_family is contracts.RuntimeOsFamily.DARWIN:
        full_fsync = getattr(fcntl, "F_FULLFSYNC", 51)
        fcntl.fcntl(descriptor, full_fsync)
    else:
        os.fsync(descriptor)


def _sync_darwin_anchor(
    gate_fd: int,
    profile: contracts.ProofAuthorityDurabilityProfile,
) -> None:
    if profile.os_family is not contracts.RuntimeOsFamily.DARWIN:
        return
    identity = profile.sync_anchor_identity
    if type(identity) is not contracts.DurabilitySyncAnchorIdentity:
        raise DurabilityProfileError("Darwin profile lacks sync anchor")
    with anchored_file(gate_fd, ".durability-sync-anchor") as descriptor:
        observed = os.fstat(descriptor)
        if (
            str(observed.st_dev) != identity.device_id
            or str(observed.st_ino) != identity.inode
            or observed.st_size != identity.byte_length
        ):
            raise DurabilityProfileError("Darwin sync anchor identity mismatch")
        content = bytearray()
        while len(content) < observed.st_size:
            chunk = os.read(
                descriptor,
                min(CHUNK_LIMIT, observed.st_size - len(content)),
            )
            if not chunk:
                raise DurabilityProfileError("Darwin sync anchor is truncated")
            content.extend(chunk)
        if hashlib.sha256(content).hexdigest() != identity.content_sha256:
            raise DurabilityProfileError("Darwin sync anchor hash mismatch")
        full_fsync = getattr(fcntl, "F_FULLFSYNC", 51)
        fcntl.fcntl(descriptor, full_fsync)


def _atomic_publish_at(
    directory_fd: int,
    name: str,
    content: bytes,
    *,
    profile: contracts.ProofAuthorityDurabilityProfile,
) -> bool:
    if "/" in name or name in {"", ".", ".."}:
        raise WorkerIOError("authority runtime basename is invalid")
    temporary = (
        f".{name}.tmp-{os.getpid()}-{time.monotonic_ns()}"
    )
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view[:CHUNK_LIMIT])
            if written <= 0:
                raise WorkerIOError("authority runtime write made no progress")
            view = view[written:]
        _sync_regular_file(descriptor, profile)
    finally:
        os.close(descriptor)
    try:
        try:
            os.link(
                temporary,
                name,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
                follow_symlinks=False,
            )
            published = True
        except FileExistsError:
            if _read_regular_at(directory_fd, name) != content:
                raise WorkerIOError(
                    "authority runtime immutable object conflicts"
                )
            existing = os.open(
                name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory_fd,
            )
            try:
                _sync_regular_file(existing, profile)
            finally:
                os.close(existing)
            published = False
        os.fsync(directory_fd)
        return published
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass


def _validate_authority_profile(
    request: contracts.PersistAuthorityRuntimeRequest,
    gate_fd: int,
) -> None:
    profile = request.durability_profile
    observation = request.environment_observation
    expected_os = (
        contracts.RuntimeOsFamily.DARWIN
        if sys.platform == "darwin"
        else contracts.RuntimeOsFamily.LINUX
        if sys.platform.startswith("linux")
        else None
    )
    if expected_os is None or profile.os_family is not expected_os:
        raise DurabilityProfileError(
            "durability profile does not match live worker OS"
        )
    observed_gate = os.fstat(gate_fd)
    if (
        str(observed_gate.st_dev)
        != observation.live_mount_binding.device_id
        or observation.host_build
        != request.candidate_runtime.runtime_measurement.platform_runtime.host_build
        or observation.host_build
        != profile.capability_evidence.qualified_host_build
    ):
        raise DurabilityProfileError(
            "active durability observation does not match gate/runtime"
        )
    if profile.os_family is contracts.RuntimeOsFamily.DARWIN:
        _sync_darwin_anchor(gate_fd, profile)


def _persist_authority_runtime_result(
    request: contracts.PersistAuthorityRuntimeRequest,
    gate_fd: int,
    temporary_fd: int,
    *,
    deadline: float,
    mutation_state: list[bool],
) -> contracts.PersistAuthorityRuntimeCompleted:
    _validate_authority_profile(request, gate_fd)
    contracts.validate_finalizer_id(
        request.candidate_runtime.runtime_capture_id
    )
    bundle = _read_anchored_bytes(
        temporary_fd,
        (
            "runtime-capture-"
            f"{request.candidate_runtime.runtime_capture_id}.bundle"
        ),
        byte_limit=request.cumulative_byte_limit + MANIFEST_LIMIT + 1024,
        deadline=deadline,
    )
    if (
        hashlib.sha256(bundle).hexdigest()
        != request.candidate_runtime.runtime_capture_bundle_digest
    ):
        raise RuntimeIdentityError(
            "authority runtime bundle digest mismatch"
        )
    capture_id, measurement, captured = _decode_runtime_bundle(bundle)
    if (
        capture_id != request.candidate_runtime.runtime_capture_id
        or measurement != request.candidate_runtime.runtime_measurement
        or tuple(item.identity for item in captured)
        != request.candidate_runtime.captured_runtime_files
    ):
        raise RuntimeIdentityError(
            "authority runtime bundle differs from candidate runtime"
        )
    refs = request.candidate_runtime.runtime_artifacts
    if len(refs) != len(captured):
        raise RuntimeIdentityError(
            "authority runtime artifact cardinality mismatch"
        )
    for reference, item in zip(refs, captured):
        if (
            reference.content_sha256 != item.identity.file_sha256
            or reference.byte_length != item.identity.byte_length
        ):
            raise RuntimeIdentityError(
                "authority runtime artifact identity mismatch"
            )
    mutation_state[0] = True
    enforcement_fd = _open_or_create_directory_at(
        gate_fd,
        "finalizer-enforcement",
    )
    runtime_fd = authorization_fd = -1
    try:
        runtime_fd = _open_or_create_directory_at(
            enforcement_fd,
            "runtime",
        )
        authorization_fd = _open_or_create_directory_at(
            runtime_fd,
            request.authorization_id,
        )
        for reference, item in zip(refs, captured):
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    "authority runtime persistence deadline expired"
                )
            _atomic_publish_at(
                authorization_fd,
                f"{reference.content_sha256}.blob",
                item.content,
                profile=request.durability_profile,
            )
        identity_bytes = contracts.canonical_json_bytes(
            request.candidate_runtime.to_dict()
        )
        _atomic_publish_at(
            authorization_fd,
            "identity.json",
            identity_bytes,
            profile=request.durability_profile,
        )
        os.fsync(authorization_fd)
        os.fsync(runtime_fd)
        os.fsync(enforcement_fd)
        os.fsync(gate_fd)
        _sync_darwin_anchor(gate_fd, request.durability_profile)
    finally:
        if authorization_fd >= 0:
            os.close(authorization_fd)
        if runtime_fd >= 0:
            os.close(runtime_fd)
        os.close(enforcement_fd)
    payload = {
        "identity": request.identity.to_dict(),
        "status": "COMPLETED",
        "durableBoundary": "AUTHORITY_RUNTIME_DURABLE",
        "maintenanceRuntimeDigest": (
            request.candidate_runtime.maintenance_runtime_digest
        ),
        "failureCode": None,
        "diagnostic": None,
    }
    return contracts.PersistAuthorityRuntimeCompleted(
        request.identity,
        request.candidate_runtime.maintenance_runtime_digest,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1",
            payload,
        ),
    )


def _persist_authority_runtime_failure(
    request: contracts.PersistAuthorityRuntimeRequest,
    error: BaseException,
    *,
    mutation_attempted: bool,
) -> contracts.PersistAuthorityRuntimeFailed | contracts.PersistAuthorityRuntimeRejected:
    diagnostic = (
        f"{type(error).__name__}: {error}"[:4096]
        or "authority runtime persistence failed"
    )
    if mutation_attempted:
        payload = {
            "identity": request.identity.to_dict(),
            "status": "FAILED",
            "durableBoundary": "AUTHORITY_RUNTIME_MAY_BE_DURABLE",
            "maintenanceRuntimeDigest": (
                request.candidate_runtime.maintenance_runtime_digest
            ),
            "failureCode": (
                contracts.FinalizerFailureCode
                .AUTHORITY_RUNTIME_IO_FAILED.value
            ),
            "diagnostic": diagnostic,
        }
        return contracts.PersistAuthorityRuntimeFailed(
            request.identity,
            request.candidate_runtime.maintenance_runtime_digest,
            diagnostic,
            contracts.domain_separated_sha256(
                "pt.acceptance.finalization.worker-result.v1",
                payload,
            ),
        )
    code = (
        contracts.FinalizerFailureCode.DURABILITY_PROFILE_UNSUPPORTED
        if isinstance(error, DurabilityProfileError)
        else contracts.FinalizerFailureCode.TIMED_OUT
        if isinstance(error, TimeoutError)
        else contracts.FinalizerFailureCode.INPUT_TOO_LARGE
        if isinstance(error, OverflowError)
        else contracts.FinalizerFailureCode.RUNTIME_MISMATCH
        if isinstance(error, (RuntimeIdentityError, ValueError))
        else contracts.FinalizerFailureCode.AUTHORITY_RUNTIME_IO_FAILED
    )
    payload = {
        "identity": request.identity.to_dict(),
        "status": "REJECTED",
        "durableBoundary": "NO_MUTATION",
        "maintenanceRuntimeDigest": None,
        "failureCode": code.value,
        "diagnostic": diagnostic,
    }
    return contracts.PersistAuthorityRuntimeRejected(
        request.identity,
        code,
        diagnostic,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1",
            payload,
        ),
    )


def _open_directory_at(parent_fd: int, name: str) -> int:
    if "/" in name or name in {"", ".", ".."}:
        raise WorkerIOError("directory basename is invalid")
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=parent_fd,
    )
    observed = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(observed.st_mode)
        or observed.st_uid != os.geteuid()
        or observed.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
    ):
        os.close(descriptor)
        raise WorkerIOError("authority directory is not owner-controlled")
    return descriptor


def _read_json_at(
    directory_fd: int,
    name: str,
    *,
    byte_limit: int = 2 * 1024 * 1024,
) -> tuple[dict[str, object], bytes]:
    content = _read_regular_at(directory_fd, name)
    if len(content) > byte_limit:
        raise OverflowError("authority JSON exceeds byte limit")
    value = contracts._strict_json_value(content)
    if type(value) is not dict:
        raise WorkerIOError("authority JSON must be an object")
    return value, content


def _read_optional_json_at(
    directory_fd: int,
    name: str,
    *,
    byte_limit: int = 2 * 1024 * 1024,
) -> tuple[dict[str, object], bytes] | None:
    try:
        return _read_json_at(
            directory_fd,
            name,
            byte_limit=byte_limit,
        )
    except FileNotFoundError:
        return None


def _atomic_replace_at(
    directory_fd: int,
    name: str,
    content: bytes,
    *,
    profile: contracts.ProofAuthorityDurabilityProfile,
) -> None:
    temporary = (
        f".{name}.tmp-{os.getpid()}-{time.monotonic_ns()}"
    )
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        view = memoryview(content)
        while view:
            written = os.write(descriptor, view[:CHUNK_LIMIT])
            if written <= 0:
                raise WorkerIOError("authority selector write made no progress")
            view = view[written:]
        _sync_regular_file(descriptor, profile)
    finally:
        os.close(descriptor)
    try:
        os.replace(
            temporary,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        os.fsync(directory_fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass


def _acquire_flock_at(
    directory_fd: int,
    name: str,
    *,
    deadline: float,
) -> int:
    descriptor = os.open(
        name,
        os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
        dir_fd=directory_fd,
    )
    while True:
        try:
            fcntl.flock(
                descriptor,
                fcntl.LOCK_EX | fcntl.LOCK_NB,
            )
            return descriptor
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(descriptor)
                raise TimeoutError("maintenance lock deadline expired")
            time.sleep(min(0.01, deadline - time.monotonic()))


def _resolve_authority_runtime(
    gate_fd: int,
    *,
    authorization_id: str,
    expected_digest: str,
) -> contracts.FinalizerMaintenanceRuntimeIdentity:
    enforcement_fd = _open_directory_at(
        gate_fd,
        "finalizer-enforcement",
    )
    runtime_fd = authorization_fd = -1
    try:
        runtime_fd = _open_directory_at(enforcement_fd, "runtime")
        authorization_fd = _open_directory_at(
            runtime_fd,
            authorization_id,
        )
        identity_value, identity_bytes = _read_json_at(
            authorization_fd,
            "identity.json",
        )
        runtime = (
            contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(
                identity_value
            )
        )
        if (
            runtime.maintenance_runtime_digest != expected_digest
            or contracts.canonical_json_bytes(runtime.to_dict())
            != identity_bytes
        ):
            raise RuntimeIdentityError(
                "persisted authority runtime identity mismatch"
            )
        contents = []
        for reference in runtime.runtime_artifacts:
            content = _read_regular_at(
                authorization_fd,
                f"{reference.content_sha256}.blob",
            )
            if (
                len(content) != reference.byte_length
                or hashlib.sha256(content).hexdigest()
                != reference.content_sha256
            ):
                raise RuntimeIdentityError(
                    "persisted authority runtime blob mismatch"
                )
            contents.append(
                CapturedRuntimeContent(
                    runtime.captured_runtime_files[len(contents)],
                    content,
                )
            )
        bundle = _encode_runtime_bundle(
            runtime.runtime_capture_id,
            runtime.runtime_measurement,
            tuple(contents),
        )
        if (
            hashlib.sha256(bundle).hexdigest()
            != runtime.runtime_capture_bundle_digest
        ):
            raise RuntimeIdentityError(
                "persisted authority runtime bundle mismatch"
            )
        return runtime
    finally:
        if authorization_fd >= 0:
            os.close(authorization_fd)
        if runtime_fd >= 0:
            os.close(runtime_fd)
        os.close(enforcement_fd)


def _validate_maintenance_profile(
    *,
    profile: contracts.ProofAuthorityDurabilityProfile,
    observation: contracts.ActiveDurabilityEnvironmentObservation,
    runtime: contracts.FinalizerMaintenanceRuntimeIdentity,
    gate_fd: int,
) -> None:
    capability = profile.capability_evidence
    qualified = contracts.DurabilityQualifiedEnvironment.create(
        host_build=capability.qualified_host_build,
        host_identity=capability.qualified_host_identity,
        filesystem_implementation_version=(
            capability.filesystem_implementation_version
        ),
        required_mount_options=capability.required_mount_options,
        stable_volume_identity=capability.stable_volume_identity,
        probe_runtime_digest=capability.probe_runtime_digest,
    )
    contracts.validate_durability_environment_observation(
        observation,
        qualified,
    )
    capability.validate_maintenance_source(runtime)
    expected_os = (
        contracts.RuntimeOsFamily.DARWIN
        if sys.platform == "darwin"
        else contracts.RuntimeOsFamily.LINUX
        if sys.platform.startswith("linux")
        else None
    )
    if expected_os is None or profile.os_family is not expected_os:
        raise DurabilityProfileError(
            "maintenance profile does not match live worker OS"
        )
    if (
        str(os.fstat(gate_fd).st_dev)
        != observation.live_mount_binding.device_id
        or observation.host_build
        != runtime.runtime_measurement.platform_runtime.host_build
    ):
        raise DurabilityProfileError(
            "maintenance observation does not match gate/runtime"
        )
    _sync_darwin_anchor(gate_fd, profile)


def _maintenance_result(
    result_type: type,
    **values: object,
) -> contracts.MaintenanceResult:
    unsigned = object.__new__(result_type)
    for field in contracts.dataclass_fields(result_type):
        if field.name == "result_digest":
            object.__setattr__(unsigned, field.name, "0" * 64)
        else:
            object.__setattr__(unsigned, field.name, values[field.name])
    payload = unsigned._payload()
    values["result_digest"] = contracts.domain_separated_sha256(
        "pt.acceptance.finalization.maintenance-result.v1",
        payload,
    )
    return result_type(**values)


def _maintenance_rejection_code(
    error: BaseException,
) -> contracts.MaintenanceFailureCode:
    if isinstance(error, DurabilityProfileError):
        return contracts.MaintenanceFailureCode.DURABILITY_PROFILE_UNSUPPORTED
    if isinstance(error, ActiveRunError):
        return contracts.MaintenanceFailureCode.ACTIVE_RUN
    if isinstance(error, TimeoutError):
        return contracts.MaintenanceFailureCode.TIMED_OUT
    if isinstance(error, OverflowError):
        return contracts.MaintenanceFailureCode.LIMIT_EXCEEDED
    if isinstance(error, (RuntimeIdentityError, ValueError)):
        return contracts.MaintenanceFailureCode.IDENTITY_MISMATCH
    if isinstance(error, WorkerIOError):
        return contracts.MaintenanceFailureCode.DURABLE_STATE_CONFLICT
    return contracts.MaintenanceFailureCode.IO_FAILED


def _validate_interlock_quiescence(
    gate_fd: int,
    interlock: contracts.FinalizerPublicationInterlock,
) -> None:
    expected = interlock.authorization.proof_admission_quiescence
    if type(expected) is not contracts.ProofAdmissionQuiescence:
        raise WorkerIOError("interlock authorization lacks quiescence")
    contracts.validate_finalizer_id(expected.coordinator_epoch_id)
    claim_fd = epochs_fd = pauses_fd = jobs_fd = completions_fd = -1
    emissions_fd = -1
    try:
        claim_fd = _open_directory_at(gate_fd, "claim-admission")
        epochs_fd = _open_directory_at(claim_fd, "epochs")
        epoch = contracts.ProofAdmissionEpochRecord.from_dict(
            _read_json_at(
                epochs_fd,
                f"{expected.coordinator_epoch_id}.json",
            )[0]
        )
        current_epoch = contracts.ProofAdmissionCurrentEpoch.from_dict(
            _read_json_at(claim_fd, "current-epoch.json")[0]
        )
        pauses_fd = _open_directory_at(claim_fd, "pauses")
        pause = contracts.ProofAdmissionPauseRecord.from_dict(
            _read_json_at(
                pauses_fd,
                f"{expected.coordinator_epoch_id}.json",
            )[0]
        )
        jobs_root = _open_directory_at(claim_fd, "jobs")
        try:
            jobs_fd = _open_directory_at(
                jobs_root,
                expected.coordinator_epoch_id,
            )
        finally:
            os.close(jobs_root)
        jobs = tuple(
            contracts.ProofAdmissionJobRecord.from_dict(
                _read_json_at(jobs_fd, name)[0]
            )
            for name in sorted(os.listdir(jobs_fd))
            if name.endswith(".json")
        )
        jobs_by_sequence = {item.job_sequence: item for item in jobs}
        completions_root = _open_directory_at(
            claim_fd,
            "completions",
        )
        try:
            completions_fd = _open_directory_at(
                completions_root,
                expected.coordinator_epoch_id,
            )
        finally:
            os.close(completions_root)
        completion_values = []
        for name in sorted(os.listdir(completions_fd)):
            if not name.endswith(".json"):
                continue
            raw = _read_json_at(completions_fd, name)[0]
            job = jobs_by_sequence.get(raw.get("jobSequence"))
            if job is None:
                raise WorkerIOError(
                    "proof-admission completion lacks job"
                )
            completion_values.append(
                contracts.ProofAdmissionJobCompletion.from_dict(
                    raw,
                    job=job,
                    epoch=epoch,
                    pause=pause,
                )
            )
        completions = tuple(completion_values)
        completions_by_sequence = {
            item.job_sequence: item for item in completions
        }
        intents = []
        acknowledgements = []
        emissions_root = _open_directory_at(claim_fd, "emissions")
        try:
            emissions_fd = _open_directory_at(
                emissions_root,
                expected.coordinator_epoch_id,
            )
        finally:
            os.close(emissions_root)
        for name in sorted(os.listdir(emissions_fd)):
            emission_fd = _open_directory_at(emissions_fd, name)
            try:
                intent_value = _read_optional_json_at(
                    emission_fd,
                    "intent.json",
                )
                acknowledgement_value = _read_optional_json_at(
                    emission_fd,
                    "acknowledged.json",
                )
                if intent_value is None:
                    if acknowledgement_value is not None:
                        raise WorkerIOError(
                            "proof acknowledgement lacks intent"
                        )
                    continue
                sequence = intent_value[0].get("jobSequence")
                job = jobs_by_sequence.get(sequence)
                completion = completions_by_sequence.get(sequence)
                if job is None or completion is None:
                    raise WorkerIOError(
                        "proof intent lacks job/completion"
                    )
                intent = (
                    contracts.ProofAdmissionEmissionIntent.from_dict(
                        intent_value[0],
                        job=job,
                        completion=completion,
                        epoch=epoch,
                    )
                )
                intents.append(intent)
                if acknowledgement_value is not None:
                    acknowledgements.append(
                        contracts.ProofAdmissionEmissionAcknowledgement.from_dict(
                            acknowledgement_value[0],
                            intent=intent,
                        )
                    )
            finally:
                os.close(emission_fd)
        resolved = contracts.ProofAdmissionQuiescence.from_dict(
            expected.to_dict(),
            epoch=epoch,
            current_epoch=current_epoch,
            pause=pause,
            jobs=jobs,
            completions=completions,
            intents=tuple(intents),
            acknowledgements=tuple(acknowledgements),
        )
        if resolved != expected:
            raise WorkerIOError(
                "resolved proof-admission quiescence changed"
            )
    except FileNotFoundError as error:
        # Empty job/emission roots are still required durable directories.
        raise WorkerIOError(
            "proof-admission quiescence closure is incomplete"
        ) from error
    finally:
        for descriptor in (
            emissions_fd,
            completions_fd,
            jobs_fd,
            pauses_fd,
            epochs_fd,
            claim_fd,
        ):
            if descriptor >= 0:
                os.close(descriptor)


def _install_interlock_result(
    request: contracts.InstallPublicationInterlockRequest,
    gate_fd: int,
    *,
    deadline: float,
) -> contracts.InstallPublicationInterlockResult:
    mutation_attempted = False
    publish_lock = -1
    try:
        authority = request.candidate_interlock.authorization
        _validate_interlock_quiescence(
            gate_fd,
            request.candidate_interlock,
        )
        runtime = _resolve_authority_runtime(
            gate_fd,
            authorization_id=authority.authorization_id,
            expected_digest=request.expected_maintenance_runtime_digest,
        )
        _validate_maintenance_profile(
            profile=authority.durability_profile,
            observation=request.environment_observation,
            runtime=runtime,
            gate_fd=gate_fd,
        )
        publish_lock = _acquire_flock_at(
            gate_fd,
            ".publish.lock",
            deadline=deadline,
        )
        current_latest = _read_optional_json_at(gate_fd, "latest.json")
        if current_latest is None:
            if (
                request.expected_prior_latest_pointer is not None
                or request.expected_prior_latest_pointer_digest is not None
            ):
                raise WorkerIOError(
                    "authorized prior latest is unexpectedly absent"
                )
        else:
            current_pointer = contracts.LatestPointer.from_dict(
                current_latest[0]
            )
            if (
                request.expected_prior_latest_pointer != current_pointer
                or request.expected_prior_latest_pointer_digest
                != current_pointer.digest()
            ):
                raise WorkerIOError(
                    "authorized prior latest does not match storage"
                )
        enforcement_fd = _open_or_create_directory_at(
            gate_fd,
            "finalizer-enforcement",
        )
        try:
            for forbidden in (
                "activation-pending.json",
                "activated.json",
                "current.json",
            ):
                if _read_optional_json_at(enforcement_fd, forbidden) is not None:
                    raise WorkerIOError(
                        "enforcement already advanced beyond interlock"
                    )
            encoded = contracts.canonical_json_bytes(
                request.candidate_interlock.to_dict()
            )
            if len(encoded) > request.byte_limit:
                raise OverflowError("interlock exceeds byte limit")
            mutation_attempted = True
            _atomic_publish_at(
                enforcement_fd,
                "publication-interlock.json",
                encoded,
                profile=authority.durability_profile,
            )
            os.fsync(enforcement_fd)
            os.fsync(gate_fd)
            _sync_darwin_anchor(gate_fd, authority.durability_profile)
        finally:
            os.close(enforcement_fd)
        return _maintenance_result(
            contracts.InstallPublicationInterlockCompleted,
            identity=request.identity,
            failure_code=None,
            diagnostic=None,
            interlock_digest=request.candidate_interlock.interlock_digest,
        )
    except BaseException as error:
        diagnostic = (
            f"{type(error).__name__}: {error}"[:4096]
            or "interlock installation failed"
        )
        if mutation_attempted:
            return _maintenance_result(
                contracts.InstallPublicationInterlockFailed,
                identity=request.identity,
                failure_code=(
                    contracts.MaintenanceFailureCode.IO_FAILED
                ),
                diagnostic=diagnostic,
                interlock_digest=(
                    request.candidate_interlock.interlock_digest
                ),
            )
        return _maintenance_result(
            contracts.InstallPublicationInterlockRejected,
            identity=request.identity,
            failure_code=(
                contracts.MaintenanceFailureCode.REQUEST_INVALID
                if isinstance(error, OverflowError)
                else _maintenance_rejection_code(error)
            ),
            diagnostic=diagnostic,
            interlock_digest=None,
        )
    finally:
        if publish_lock >= 0:
            fcntl.flock(publish_lock, fcntl.LOCK_UN)
            os.close(publish_lock)


def _validate_interlock_digest_at(
    enforcement_fd: int,
    *,
    expected_digest: str,
    workspace_id: str,
    gate_id: str,
    required_finalizer_id: str,
) -> None:
    value, encoded = _read_json_at(
        enforcement_fd,
        "publication-interlock.json",
    )
    required = {
        "artifactKind",
        "schemaVersion",
        "workspaceId",
        "gateId",
        "requiredFinalizerId",
        "installedAt",
        "installationSourceCommit",
        "proofAdmissionSourceDigest",
        "authorization",
        "interlockDigest",
    }
    if (
        set(value) != required
        or value["artifactKind"]
        != "acceptance-finalizer-publication-interlock"
        or value["schemaVersion"] != 1
        or value["workspaceId"] != workspace_id
        or value["gateId"] != gate_id
        or value["requiredFinalizerId"] != required_finalizer_id
        or value["interlockDigest"] != expected_digest
        or contracts.domain_separated_sha256(
            "pt.acceptance.finalization.publication-interlock.v1",
            {
                key: item
                for key, item in value.items()
                if key != "interlockDigest"
            },
        )
        != expected_digest
        or contracts.canonical_json_bytes(value) != encoded
    ):
        raise WorkerIOError("publication interlock identity is invalid")


def _scan_no_active_required_runs(
    gate_fd: int,
    *,
    entry_limit: int,
) -> None:
    entries = os.listdir(gate_fd)
    if len(entries) > entry_limit:
        raise OverflowError("gate directory exceeds activation entry limit")
    for name in entries:
        try:
            contracts._validate_run_id(name, field="evidenceRunId")
        except ValueError:
            continue
        try:
            run_fd = _open_directory_at(gate_fd, name)
        except FileNotFoundError:
            continue
        try:
            try:
                requirement = os.stat(
                    "finalization-requirement.json",
                    dir_fd=run_fd,
                    follow_symlinks=False,
                )
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(requirement.st_mode):
                raise WorkerIOError(
                    "required-run marker is not a regular file"
                )
            active_fd = os.open(
                ".active.lock",
                os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=run_fd,
            )
            try:
                try:
                    fcntl.flock(
                        active_fd,
                        fcntl.LOCK_EX | fcntl.LOCK_NB,
                    )
                except BlockingIOError as error:
                    raise ActiveRunError(
                        f"required run is active: {name}"
                    ) from error
                finally:
                    try:
                        fcntl.flock(active_fd, fcntl.LOCK_UN)
                    except OSError:
                        pass
            finally:
                os.close(active_fd)
        finally:
            os.close(run_fd)


def _captured_latest_for_activation(
    request: contracts.ActivateEnforcementRequest,
    gate_fd: int,
    enforcement_fd: int,
) -> contracts.LatestPointer | None:
    intent = request.intent
    if intent.target_generation == 1:
        current = _read_optional_json_at(gate_fd, "latest.json")
    else:
        latest_fd = _open_directory_at(
            enforcement_fd,
            "latest",
        )
        try:
            current = _read_optional_json_at(
                latest_fd,
                f"{intent.expected_current_generation}.json",
            )
        finally:
            os.close(latest_fd)
    pointer = (
        None
        if current is None
        else contracts.LatestPointer.from_dict(current[0])
    )
    if (
        pointer != intent.expected_prior_latest_pointer
        or (
            None if pointer is None else pointer.digest()
        )
        != intent.expected_prior_latest_pointer_digest
    ):
        raise WorkerIOError(
            "activation prior latest does not match authorization"
        )
    return pointer


def _activation_pending(
    request: contracts.ActivateEnforcementRequest,
    prior: contracts.LatestPointer | None,
) -> contracts.FinalizerActivationPending:
    intent = request.intent
    record_payload = {
        "artifactKind": (
            contracts.FinalizerEnforcementRecord.artifact_kind
        ),
        "schemaVersion": 1,
        "generation": intent.target_generation,
        "workspaceId": intent.workspace_id,
        "gateId": intent.gate_id,
        "requiredFinalizerId": intent.required_finalizer_id,
        "activationIntent": intent.to_dict(),
        "activatedAt": intent.activated_at,
        "activationSourceCommit": intent.activation_source_commit,
        "priorLatestPointer": (
            None if prior is None else prior.to_dict()
        ),
        "priorLatestPointerDigest": (
            None if prior is None else prior.digest()
        ),
        "requirementDigest": intent.requirement_digest,
        "configDigest": intent.config_digest,
        "sourceDigest": intent.source_digest,
        "protectedBaselineDigest": intent.protected_baseline_digest,
    }
    record = contracts.FinalizerEnforcementRecord.from_dict(
        {
            **record_payload,
            "enforcementDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.enforcement.v1",
                record_payload,
            ),
        }
    )
    current = contracts.FinalizerEnforcementCurrent.create(
        workspace_id=intent.workspace_id,
        gate_id=intent.gate_id,
        required_finalizer_id=intent.required_finalizer_id,
        generation=intent.target_generation,
        enforcement_digest=record.enforcement_digest,
    )
    activated = (
        contracts.FinalizerEnforcementActivated.create(
            workspace_id=intent.workspace_id,
            gate_id=intent.gate_id,
            required_finalizer_id=intent.required_finalizer_id,
            first_generation=1,
            first_enforcement_digest=record.enforcement_digest,
            activated_at=intent.activated_at,
            activation_source_commit=intent.activation_source_commit,
            activation_intent_digest=intent.intent_digest,
        )
        if intent.target_generation == 1
        else None
    )
    pending_payload = {
        "artifactKind": (
            contracts.FinalizerActivationPending.artifact_kind
        ),
        "schemaVersion": 1,
        "intent": intent.to_dict(),
        "candidateEnforcementRecord": record.to_dict(),
        "candidateActivated": (
            None if activated is None else activated.to_dict()
        ),
        "candidateCurrent": current.to_dict(),
    }
    return contracts.FinalizerActivationPending.from_dict(
        {
            **pending_payload,
            "pendingDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.activation-pending.v1",
                pending_payload,
            ),
        }
    )


def _activate_enforcement_result(
    request: contracts.ActivateEnforcementRequest,
    gate_fd: int,
    *,
    deadline: float,
) -> contracts.ActivateEnforcementResult:
    cleanup_lock = publish_lock = enforcement_fd = generations_fd = -1
    boundary: str | None = None
    pending: contracts.FinalizerActivationPending | None = None
    try:
        authority = request.intent.authorization
        runtime = _resolve_authority_runtime(
            gate_fd,
            authorization_id=authority.authorization_id,
            expected_digest=request.expected_maintenance_runtime_digest,
        )
        _validate_maintenance_profile(
            profile=authority.durability_profile,
            observation=request.environment_observation,
            runtime=runtime,
            gate_fd=gate_fd,
        )
        cleanup_lock = _acquire_flock_at(
            gate_fd,
            ".cleanup.lock",
            deadline=deadline,
        )
        _scan_no_active_required_runs(
            gate_fd,
            entry_limit=request.entry_limit,
        )
        publish_lock = _acquire_flock_at(
            gate_fd,
            ".publish.lock",
            deadline=deadline,
        )
        enforcement_fd = _open_directory_at(
            gate_fd,
            "finalizer-enforcement",
        )
        _validate_interlock_digest_at(
            enforcement_fd,
            expected_digest=authority.expected_interlock_digest,
            workspace_id=request.workspace_id,
            gate_id=request.gate_id,
            required_finalizer_id=request.intent.required_finalizer_id,
        )
        existing_pending = _read_optional_json_at(
            enforcement_fd,
            "activation-pending.json",
            byte_limit=request.byte_limit,
        )
        existing_current = _read_optional_json_at(
            enforcement_fd,
            "current.json",
            byte_limit=request.byte_limit,
        )
        if existing_pending is None:
            if existing_current is not None:
                current = contracts.FinalizerEnforcementCurrent.from_dict(
                    existing_current[0]
                )
                if current.generation >= request.intent.target_generation:
                    generations_fd = _open_directory_at(
                        enforcement_fd,
                        "generations",
                    )
                    previous_generation = None
                    target_record = None
                    for generation_number in range(
                        request.intent.target_generation,
                        current.generation + 1,
                    ):
                        value, encoded = _read_json_at(
                            generations_fd,
                            f"{generation_number}.json",
                            byte_limit=request.byte_limit,
                        )
                        record = (
                            contracts.FinalizerEnforcementRecord.from_dict(
                                value
                            )
                        )
                        if (
                            record.generation != generation_number
                            or contracts.canonical_json_bytes(
                                record.to_dict()
                            )
                            != encoded
                            or (
                                previous_generation is not None
                                and record.activation_intent
                                .expected_current_generation
                                != previous_generation.generation
                            )
                        ):
                            raise WorkerIOError(
                                "terminal activation generation chain is invalid"
                            )
                        if target_record is None:
                            target_record = record
                        previous_generation = record
                    if (
                        target_record is None
                        or target_record.activation_intent != request.intent
                        or previous_generation is None
                        or previous_generation.enforcement_digest
                        != current.enforcement_digest
                    ):
                        raise WorkerIOError(
                            "terminal activation retry differs from request"
                        )
                    for name in ("current.json", "activated.json"):
                        descriptor = os.open(
                            name,
                            os.O_RDONLY
                            | os.O_NOFOLLOW
                            | os.O_CLOEXEC,
                            dir_fd=enforcement_fd,
                        )
                        try:
                            _sync_regular_file(
                                descriptor,
                                authority.durability_profile,
                            )
                        finally:
                            os.close(descriptor)
                    os.fsync(generations_fd)
                    os.fsync(enforcement_fd)
                    os.fsync(gate_fd)
                    _sync_darwin_anchor(
                        gate_fd,
                        authority.durability_profile,
                    )
                    return _maintenance_result(
                        contracts.ActivateEnforcementCompleted,
                        identity=request.identity,
                        failure_code=None,
                        diagnostic=None,
                        generation=target_record.generation,
                        enforcement_digest=(
                            target_record.enforcement_digest
                        ),
                    )
            if request.intent.target_generation == 1:
                if existing_current is not None:
                    raise WorkerIOError(
                        "first activation found existing current selector"
                    )
            else:
                if existing_current is None:
                    raise WorkerIOError(
                        "next activation lacks current selector"
                    )
                current = contracts.FinalizerEnforcementCurrent.from_dict(
                    existing_current[0]
                )
                if (
                    current.generation
                    != request.intent.expected_current_generation
                ):
                    raise WorkerIOError(
                        "activation expected current generation changed"
                    )
            prior = _captured_latest_for_activation(
                request,
                gate_fd,
                enforcement_fd,
            )
            pending = _activation_pending(request, prior)
            pending_bytes = contracts.canonical_json_bytes(
                pending.to_dict()
            )
            if len(pending_bytes) > request.byte_limit:
                raise OverflowError("activation pending exceeds byte limit")
            boundary = "PENDING_DURABLE"
            _atomic_publish_at(
                enforcement_fd,
                "activation-pending.json",
                pending_bytes,
                profile=authority.durability_profile,
            )
        else:
            pending = contracts.FinalizerActivationPending.from_dict(
                existing_pending[0]
            )
            if (
                pending.intent != request.intent
                or contracts.canonical_json_bytes(pending.to_dict())
                != existing_pending[1]
            ):
                raise WorkerIOError(
                    "existing activation pending conflicts with request"
                )
            boundary = "PENDING_DURABLE"
            pending_fd = os.open(
                "activation-pending.json",
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=enforcement_fd,
            )
            try:
                _sync_regular_file(
                    pending_fd,
                    authority.durability_profile,
                )
            finally:
                os.close(pending_fd)
            os.fsync(enforcement_fd)
        generations_fd = _open_or_create_directory_at(
            enforcement_fd,
            "generations",
        )
        record = pending.candidate_enforcement_record
        boundary = "GENERATION_DURABLE"
        _atomic_publish_at(
            generations_fd,
            f"{record.generation}.json",
            contracts.canonical_json_bytes(record.to_dict()),
            profile=authority.durability_profile,
        )
        if pending.candidate_activated is not None:
            boundary = "ACTIVATION_SENTINEL_DURABLE"
            _atomic_publish_at(
                enforcement_fd,
                "activated.json",
                contracts.canonical_json_bytes(
                    pending.candidate_activated.to_dict()
                ),
                profile=authority.durability_profile,
            )
        else:
            activated_value, _ = _read_json_at(
                enforcement_fd,
                "activated.json",
                byte_limit=request.byte_limit,
            )
            activated = (
                contracts.FinalizerEnforcementActivated.from_dict(
                    activated_value
                )
            )
            if (
                activated.workspace_id,
                activated.gate_id,
                activated.required_finalizer_id,
            ) != (
                request.workspace_id,
                request.gate_id,
                request.intent.required_finalizer_id,
            ):
                raise WorkerIOError(
                    "activation sentinel identity mismatch"
                )
        boundary = "CURRENT_DURABLE"
        current_bytes = contracts.canonical_json_bytes(
            pending.candidate_current.to_dict()
        )
        current_existing = _read_optional_json_at(
            enforcement_fd,
            "current.json",
            byte_limit=request.byte_limit,
        )
        if (
            current_existing is not None
            and current_existing[1] == current_bytes
        ):
            current_fd = os.open(
                "current.json",
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=enforcement_fd,
            )
            try:
                _sync_regular_file(
                    current_fd,
                    authority.durability_profile,
                )
            finally:
                os.close(current_fd)
            os.fsync(enforcement_fd)
        else:
            _atomic_replace_at(
                enforcement_fd,
                "current.json",
                current_bytes,
                profile=authority.durability_profile,
            )
        try:
            os.unlink("activation-pending.json", dir_fd=enforcement_fd)
        except FileNotFoundError:
            pass
        os.fsync(enforcement_fd)
        os.fsync(gate_fd)
        _sync_darwin_anchor(gate_fd, authority.durability_profile)
        return _maintenance_result(
            contracts.ActivateEnforcementCompleted,
            identity=request.identity,
            failure_code=None,
            diagnostic=None,
            generation=record.generation,
            enforcement_digest=record.enforcement_digest,
        )
    except BaseException as error:
        diagnostic = (
            f"{type(error).__name__}: {error}"[:4096]
            or "activation failed"
        )
        if boundary is None:
            return _maintenance_result(
                contracts.ActivateEnforcementRejected,
                identity=request.identity,
                failure_code=_maintenance_rejection_code(error),
                diagnostic=diagnostic,
                generation=None,
                enforcement_digest=None,
            )
        if pending is None:
            raise
        return _maintenance_result(
            contracts.ActivateEnforcementFailed,
            identity=request.identity,
            failure_code=(
                contracts.MaintenanceFailureCode.TIMED_OUT
                if isinstance(error, TimeoutError)
                else contracts.MaintenanceFailureCode.IO_FAILED
            ),
            diagnostic=diagnostic,
            generation=pending.intent.target_generation,
            enforcement_digest=(
                pending.candidate_enforcement_record.enforcement_digest
            ),
            durable_boundary=boundary,
        )
    finally:
        for descriptor in (
            generations_fd,
            enforcement_fd,
            publish_lock,
            cleanup_lock,
        ):
            if descriptor >= 0:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                except OSError:
                    pass
                os.close(descriptor)


def _latest_targets_run(
    gate_fd: int,
    *,
    run_id: str,
) -> bool:
    legacy = _read_optional_json_at(gate_fd, "latest.json")
    if (
        legacy is not None
        and contracts.LatestPointer.from_dict(legacy[0]).run_id == run_id
    ):
        return True
    try:
        enforcement_fd = _open_directory_at(
            gate_fd,
            "finalizer-enforcement",
        )
    except FileNotFoundError:
        return False
    latest_fd = -1
    try:
        try:
            latest_fd = _open_directory_at(enforcement_fd, "latest")
        except FileNotFoundError:
            return False
        for name in os.listdir(latest_fd):
            if not name.endswith(".json"):
                continue
            pointer = contracts.LatestPointer.from_dict(
                _read_json_at(latest_fd, name)[0]
            )
            if pointer.run_id == run_id:
                return True
        return False
    finally:
        if latest_fd >= 0:
            os.close(latest_fd)
        os.close(enforcement_fd)


def _write_abort_authorization_result(
    request: contracts.WriteAbortEventRequest,
    gate_fd: int,
    *,
    deadline: float,
) -> contracts.WriteAbortEventResult:
    cleanup_lock = publish_lock = abort_lock = -1
    run_fd = active_fd = finalization_fd = -1
    mutation_attempted = False
    candidate_event: contracts.AbortSealedAuditEvent | None = None
    try:
        authorization = request.authorization
        runtime = _resolve_authority_runtime(
            gate_fd,
            authorization_id=authorization.authorization_id,
            expected_digest=request.expected_maintenance_runtime_digest,
        )
        _validate_maintenance_profile(
            profile=authorization.durability_profile,
            observation=request.environment_observation,
            runtime=runtime,
            gate_fd=gate_fd,
        )
        cleanup_lock = _acquire_flock_at(
            gate_fd,
            ".cleanup.lock",
            deadline=deadline,
        )
        publish_lock = _acquire_flock_at(
            gate_fd,
            ".publish.lock",
            deadline=deadline,
        )
        abort_lock = _acquire_flock_at(
            gate_fd,
            ".abort.lock",
            deadline=deadline,
        )
        run_fd = _open_directory_at(
            gate_fd,
            request.evidence_run_id,
        )
        observed_run = os.fstat(run_fd)
        claim = authorization.run_directory_claim
        if (
            str(observed_run.st_dev) != claim.device_id
            or str(observed_run.st_ino) != claim.inode
        ):
            raise WorkerIOError("abort run directory identity changed")
        active_fd = os.open(
            ".active.lock",
            os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=run_fd,
        )
        try:
            fcntl.flock(
                active_fd,
                fcntl.LOCK_EX | fcntl.LOCK_NB,
            )
        except BlockingIOError as error:
            raise WorkerIOError("abort target run remains active") from error
        finalization_fd = os.open(
            ".finalization.lock",
            os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=run_fd,
        )
        try:
            fcntl.flock(
                finalization_fd,
                fcntl.LOCK_EX | fcntl.LOCK_NB,
            )
        except BlockingIOError as error:
            raise WorkerIOError(
                "abort target finalization remains active"
            ) from error
        seal = contracts.SealedEvidenceMarker.from_dict(
            _read_json_at(run_fd, "sealed.json")[0]
        )
        requirement = contracts.FinalizerRequirementRecord.from_dict(
            _read_json_at(
                run_fd,
                "finalization-requirement.json",
            )[0]
        )
        if (
            seal.snapshot.snapshot_digest != authorization.snapshot_digest
            or requirement.requirement_digest
            != authorization.requirement_digest
        ):
            raise WorkerIOError(
                "abort authorization does not match sealed run"
            )
        if _latest_targets_run(
            gate_fd,
            run_id=request.evidence_run_id,
        ):
            raise WorkerIOError(
                "authoritative latest run cannot be aborted"
            )
        projection = (
            contracts.AbortEventAuthorizationProjection.from_authorization(
                authorization
            )
        )
        candidate_event = contracts.AbortSealedAuditEvent.create(
            event_type=contracts.AbortEventType.AUTHORIZED,
            event_sequence=1,
            previous_event_digest=None,
            authorization=projection,
            attempt_id=authorization.attempt_id,
            tombstone_identity_digest=(
                contracts.abort_tombstone_identity_digest(authorization)
            ),
            deletion_plan_ref=None,
            deletion_plan_digest=None,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=None,
            continuation_token=None,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        aborts_fd = _open_or_create_directory_at(gate_fd, "aborts")
        run_abort_fd = -1
        try:
            run_abort_fd = _open_or_create_directory_at(
                aborts_fd,
                request.evidence_run_id,
            )
            mutation_attempted = True
            _atomic_publish_at(
                run_abort_fd,
                "authorized.json",
                contracts.canonical_json_bytes(candidate_event.to_dict()),
                profile=authorization.durability_profile,
            )
            os.fsync(run_abort_fd)
            os.fsync(aborts_fd)
            os.fsync(gate_fd)
            _sync_darwin_anchor(
                gate_fd,
                authorization.durability_profile,
            )
        finally:
            if run_abort_fd >= 0:
                os.close(run_abort_fd)
            os.close(aborts_fd)
        return _maintenance_result(
            contracts.WriteAuthorizationCompleted,
            identity=request.identity,
            failure_code=None,
            diagnostic=None,
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            event_digest=candidate_event.event_digest,
        )
    except BaseException as error:
        diagnostic = (
            f"{type(error).__name__}: {error}"[:4096]
            or "abort authorization failed"
        )
        return _maintenance_result(
            contracts.WriteAuthorizationFailed,
            identity=request.identity,
            failure_code=(
                contracts.MaintenanceFailureCode.IO_FAILED
                if mutation_attempted
                else _maintenance_rejection_code(error)
            ),
            diagnostic=diagnostic,
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            event_digest=(
                None
                if candidate_event is None
                else candidate_event.event_digest
            ),
            durable_boundary=(
                "EVENT_MAY_BE_DURABLE"
                if mutation_attempted
                else "NONE"
            ),
        )
    finally:
        for descriptor in (
            finalization_fd,
            active_fd,
            run_fd,
            abort_lock,
            publish_lock,
            cleanup_lock,
        ):
            if descriptor >= 0:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                except OSError:
                    pass
                os.close(descriptor)


def _abort_authorization_from_event(
    event: contracts.AbortSealedAuditEvent,
) -> contracts.AbortAuthorization:
    projection = event.authorization
    return contracts.AbortAuthorization(
        authorization_id=projection.authorization_id,
        attempt_id=event.attempt_id,
        authorized_at=projection.authorized_at,
        operator_identity=projection.operator_identity,
        reason_code=projection.reason_code,
        workspace_id=projection.workspace_id,
        gate_id=projection.gate_id,
        evidence_run_id=projection.evidence_run_id,
        run_directory_claim=projection.run_directory_claim,
        snapshot_digest=projection.snapshot_digest,
        requirement_digest=projection.requirement_digest,
        authority_source_commit=projection.authority_source_commit,
        proof_admission_source_digest=(
            projection.proof_admission_source_digest
        ),
        maintenance_runtime=projection.maintenance_runtime,
        durability_profile=projection.durability_profile,
        confirmation_challenge_digest=(
            projection.confirmation_challenge_digest
        ),
    )


def _verify_native_helper_identity(
    helper_path: str,
    runtime: contracts.FinalizerMaintenanceRuntimeIdentity,
) -> None:
    if (
        not os.path.isabs(helper_path)
        or os.path.realpath(helper_path) != helper_path
    ):
        raise NativeHelperError("native helper path is not canonical")
    descriptor = os.open(
        helper_path,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        observed = os.fstat(descriptor)
        if not stat.S_ISREG(observed.st_mode):
            raise NativeHelperError("native helper is not regular")
        digest = hashlib.sha256()
        while chunk := os.read(descriptor, CHUNK_LIMIT):
            digest.update(chunk)
        if (
            digest.hexdigest()
            != runtime.runtime_measurement.supervisor_binary_sha256
        ):
            raise NativeHelperError(
                "native helper binary does not match authority runtime"
            )
    finally:
        os.close(descriptor)


def _abort_control_ref(
    *,
    workspace_id: str,
    gate_id: str,
    evidence_run_id: str,
    content_sha256: str,
) -> contracts.AbortControlArtifactRef:
    payload = {
        "artifactKind": "acceptance-abort-control-ref",
        "schemaVersion": 1,
        "workspaceId": workspace_id,
        "gateId": gate_id,
        "evidenceRunId": evidence_run_id,
        "controlName": "deletion-plan",
        "contentSha256": content_sha256,
    }
    return contracts.AbortControlArtifactRef(
        workspace_id,
        gate_id,
        evidence_run_id,
        content_sha256,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.abort-control-ref.v1",
            payload,
        ),
    )


def _build_abort_deletion_plan(
    helper_path: str,
    gate_fd: int,
    authorization: contracts.AbortAuthorization,
    *,
    entry_limit: int,
    byte_limit: int,
    deadline: float,
) -> contracts.AbortDeletionPlan:
    root_path = f"aborted-runs/{authorization.evidence_run_id}"
    root_fd = _native_openat2_fd(
        helper_path,
        gate_fd,
        root_path,
        expected_type="DIRECTORY",
        deadline=deadline,
    )
    entries: list[contracts.AbortDeletionPlanEntry] = []

    def walk(directory_fd: int, relative: str) -> None:
        for name in sorted(
            os.listdir(directory_fd),
            key=lambda item: item.encode("utf-8"),
        ):
            path = name if not relative else f"{relative}/{name}"
            opened = _native_openat2_fd(
                helper_path,
                gate_fd,
                f"{root_path}/{path}",
                expected_type="ANY",
                deadline=deadline,
            )
            try:
                observed = os.fstat(opened)
                if stat.S_ISDIR(observed.st_mode):
                    walk(opened, path)
                    file_type = "DIRECTORY"
                    byte_length = None
                elif stat.S_ISREG(observed.st_mode):
                    file_type = "REGULAR_FILE"
                    byte_length = observed.st_size
                else:
                    raise NativeHelperError(
                        "abort plan forbids special filesystem entries"
                    )
                entries.append(
                    contracts.AbortDeletionPlanEntry(
                        "CONTENT",
                        path,
                        file_type,
                        str(observed.st_dev),
                        str(observed.st_ino),
                        byte_length,
                    )
                )
                if len(entries) + 1 > entry_limit:
                    raise OverflowError(
                        "abort deletion plan exceeds entry limit"
                    )
            finally:
                os.close(opened)

    try:
        walk(root_fd, "")
        root_status = os.fstat(root_fd)
    finally:
        os.close(root_fd)
    entries.append(
        contracts.AbortDeletionPlanEntry(
            "TOMBSTONE_ROOT",
            None,
            "DIRECTORY",
            str(root_status.st_dev),
            str(root_status.st_ino),
            None,
        )
    )
    payload = {
        "artifactKind": "acceptance-abort-deletion-plan",
        "schemaVersion": 1,
        "workspaceId": authorization.workspace_id,
        "gateId": authorization.gate_id,
        "evidenceRunId": authorization.evidence_run_id,
        "authorizationId": authorization.authorization_id,
        "tombstoneIdentityDigest": (
            contracts.abort_tombstone_identity_digest(authorization)
        ),
        "entries": [entry.to_dict() for entry in entries],
    }
    plan = contracts.AbortDeletionPlan.from_dict(
        {
            **payload,
            "deletionPlanDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.abort-deletion-plan.v1",
                payload,
            ),
        }
    )
    if len(contracts.canonical_json_bytes(plan.to_dict())) > byte_limit:
        raise OverflowError("abort deletion plan exceeds byte limit")
    return plan


def _tombstone_run_result(
    request: contracts.TombstoneRunRequest,
    gate_fd: int,
    *,
    helper_path: str,
    deadline: float,
) -> contracts.TombstoneRunResult:
    cleanup_lock = publish_lock = abort_lock = -1
    run_fd = active_fd = finalization_fd = -1
    aborts_fd = run_abort_fd = aborted_fd = -1
    boundary = "AUTHORIZATION_DURABLE"
    plan: contracts.AbortDeletionPlan | None = None
    try:
        if not sys.platform.startswith("linux"):
            raise DurabilityProfileError(
                "destructive abort requires Linux openat2"
            )
        cleanup_lock = _acquire_flock_at(
            gate_fd, ".cleanup.lock", deadline=deadline
        )
        publish_lock = _acquire_flock_at(
            gate_fd, ".publish.lock", deadline=deadline
        )
        abort_lock = _acquire_flock_at(
            gate_fd, ".abort.lock", deadline=deadline
        )
        aborts_fd = _open_directory_at(gate_fd, "aborts")
        run_abort_fd = _open_directory_at(
            aborts_fd,
            request.evidence_run_id,
        )
        authorized_value, authorized_bytes = _read_json_at(
            run_abort_fd,
            "authorized.json",
        )
        authorized_event = contracts.AbortSealedAuditEvent.from_dict(
            authorized_value
        )
        if (
            authorized_event.event_type
            is not contracts.AbortEventType.AUTHORIZED
            or contracts.canonical_json_bytes(
                authorized_event.to_dict()
            )
            != authorized_bytes
            or authorized_event.authorization.authorization_id
            != request.authorization_id
            or authorized_event.attempt_id != request.attempt_id
        ):
            raise WorkerIOError(
                "durable abort authorization does not match request"
            )
        authorization = _abort_authorization_from_event(authorized_event)
        runtime = _resolve_authority_runtime(
            gate_fd,
            authorization_id=authorization.authorization_id,
            expected_digest=request.expected_maintenance_runtime_digest,
        )
        if (
            authorization.durability_profile.durability_profile_digest
            != request.expected_durability_profile_digest
        ):
            raise DurabilityProfileError(
                "abort request profile does not match authorization"
            )
        _validate_maintenance_profile(
            profile=authorization.durability_profile,
            observation=request.environment_observation,
            runtime=runtime,
            gate_fd=gate_fd,
        )
        _verify_native_helper_identity(helper_path, runtime)
        aborted_fd = _open_or_create_directory_at(
            gate_fd,
            "aborted-runs",
        )
        run_exists = request.evidence_run_id in os.listdir(gate_fd)
        tombstone_exists = (
            request.evidence_run_id in os.listdir(aborted_fd)
        )
        if run_exists and tombstone_exists:
            raise WorkerIOError(
                "run and tombstone both exist"
            )
        if run_exists:
            run_fd = _native_openat2_fd(
                helper_path,
                gate_fd,
                request.evidence_run_id,
                expected_type="DIRECTORY",
                deadline=deadline,
            )
            observed = os.fstat(run_fd)
            claim = authorization.run_directory_claim
            if (
                str(observed.st_dev) != claim.device_id
                or str(observed.st_ino) != claim.inode
            ):
                raise WorkerIOError(
                    "run identity changed before tombstone"
                )
            active_fd = os.open(
                ".active.lock",
                os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=run_fd,
            )
            finalization_fd = os.open(
                ".finalization.lock",
                os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=run_fd,
            )
            for descriptor in (active_fd, finalization_fd):
                try:
                    fcntl.flock(
                        descriptor,
                        fcntl.LOCK_EX | fcntl.LOCK_NB,
                    )
                except BlockingIOError as error:
                    raise ActiveRunError(
                        "run lock remains active during tombstone"
                    ) from error
            os.rename(
                request.evidence_run_id,
                request.evidence_run_id,
                src_dir_fd=gate_fd,
                dst_dir_fd=aborted_fd,
            )
            os.fsync(gate_fd)
            os.fsync(aborted_fd)
            boundary = "RUN_TOMBSTONED"
            tombstone_exists = True
        if not tombstone_exists:
            raise WorkerIOError("neither run nor tombstone exists")
        tombstone_fd = _native_openat2_fd(
            helper_path,
            gate_fd,
            f"aborted-runs/{request.evidence_run_id}",
            expected_type="DIRECTORY",
            deadline=deadline,
        )
        try:
            observed = os.fstat(tombstone_fd)
            claim = authorization.run_directory_claim
            if (
                str(observed.st_dev) != claim.device_id
                or str(observed.st_ino) != claim.inode
            ):
                raise WorkerIOError(
                    "tombstone identity does not match authorization"
                )
        finally:
            os.close(tombstone_fd)
        plan = _build_abort_deletion_plan(
            helper_path,
            gate_fd,
            authorization,
            entry_limit=request.deletion_plan_entry_limit,
            byte_limit=request.deletion_plan_byte_limit,
            deadline=deadline,
        )
        plan_bytes = contracts.canonical_json_bytes(plan.to_dict())
        plan_ref = _abort_control_ref(
            workspace_id=authorization.workspace_id,
            gate_id=authorization.gate_id,
            evidence_run_id=authorization.evidence_run_id,
            content_sha256=hashlib.sha256(plan_bytes).hexdigest(),
        )
        _atomic_publish_at(
            run_abort_fd,
            "deletion-plan.json",
            plan_bytes,
            profile=authorization.durability_profile,
        )
        continuation = contracts.abort_continuation_token(
            authorization_id=authorization.authorization_id,
            event_sequence=2,
            next_deletion_plan_index=0,
            deletion_plan_digest=plan.deletion_plan_digest,
            tombstone_identity_digest=plan.tombstone_identity_digest,
        )
        event = contracts.AbortSealedAuditEvent.create(
            event_type=contracts.AbortEventType.TOMBSTONED,
            event_sequence=2,
            previous_event_digest=authorized_event.event_digest,
            authorization=authorized_event.authorization,
            attempt_id=authorized_event.attempt_id,
            tombstone_identity_digest=plan.tombstone_identity_digest,
            deletion_plan_ref=plan_ref,
            deletion_plan_digest=plan.deletion_plan_digest,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=0,
            continuation_token=continuation,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        _atomic_publish_at(
            run_abort_fd,
            "tombstoned.json",
            contracts.canonical_json_bytes(event.to_dict()),
            profile=authorization.durability_profile,
        )
        os.fsync(run_abort_fd)
        os.fsync(aborts_fd)
        os.fsync(aborted_fd)
        os.fsync(gate_fd)
        return _maintenance_result(
            contracts.TombstoneRunCompleted,
            identity=request.identity,
            failure_code=None,
            diagnostic=None,
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            deletion_plan_ref=plan_ref,
            deletion_plan_digest=plan.deletion_plan_digest,
            continuation_token=continuation,
            tombstoned_event_digest=event.event_digest,
        )
    except BaseException as error:
        diagnostic = (
            f"{type(error).__name__}: {error}"[:4096]
            or "tombstone failed"
        )
        return _maintenance_result(
            contracts.TombstoneRunFailed,
            identity=request.identity,
            failure_code=(
                contracts.MaintenanceFailureCode
                .DURABILITY_PROFILE_UNSUPPORTED
                if isinstance(
                    error,
                    (DurabilityProfileError, NativeHelperError),
                )
                else contracts.MaintenanceFailureCode.TIMED_OUT
                if isinstance(error, TimeoutError)
                else contracts.MaintenanceFailureCode.LIMIT_EXCEEDED
                if isinstance(error, OverflowError)
                else contracts.MaintenanceFailureCode.DURABLE_STATE_CONFLICT
            ),
            diagnostic=diagnostic,
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            deletion_plan_ref=(
                None
                if plan is None
                else _abort_control_ref(
                    workspace_id=request.workspace_id,
                    gate_id=request.gate_id,
                    evidence_run_id=request.evidence_run_id,
                    content_sha256=hashlib.sha256(
                        contracts.canonical_json_bytes(plan.to_dict())
                    ).hexdigest(),
                )
            ),
            deletion_plan_digest=(
                None if plan is None else plan.deletion_plan_digest
            ),
            continuation_token=None,
            tombstoned_event_digest=None,
            durable_boundary=boundary,
        )
    finally:
        for descriptor in (
            aborted_fd,
            run_abort_fd,
            aborts_fd,
            finalization_fd,
            active_fd,
            run_fd,
            abort_lock,
            publish_lock,
            cleanup_lock,
        ):
            if descriptor >= 0:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                except OSError:
                    pass
                os.close(descriptor)


def _delete_tombstone_batch_result(
    request: contracts.DeleteTombstoneBatchRequest,
    gate_fd: int,
    *,
    helper_path: str,
    deadline: float,
) -> contracts.DeleteTombstoneBatchResult:
    cleanup_lock = publish_lock = abort_lock = -1
    aborts_fd = run_abort_fd = -1
    started_event: contracts.AbortSealedAuditEvent | None = None
    deleted_entries = 0
    deleted_bytes = 0
    try:
        if not sys.platform.startswith("linux"):
            raise DurabilityProfileError(
                "destructive abort requires Linux openat2"
            )
        cleanup_lock = _acquire_flock_at(
            gate_fd, ".cleanup.lock", deadline=deadline
        )
        publish_lock = _acquire_flock_at(
            gate_fd, ".publish.lock", deadline=deadline
        )
        abort_lock = _acquire_flock_at(
            gate_fd, ".abort.lock", deadline=deadline
        )
        aborts_fd = _open_directory_at(gate_fd, "aborts")
        run_abort_fd = _open_directory_at(
            aborts_fd,
            request.evidence_run_id,
        )
        authorized_event = contracts.AbortSealedAuditEvent.from_dict(
            _read_json_at(run_abort_fd, "authorized.json")[0]
        )
        authorization = _abort_authorization_from_event(
            authorized_event
        )
        if (
            authorization.authorization_id != request.authorization_id
            or request.expected_tombstone_identity_digest
            != contracts.abort_tombstone_identity_digest(authorization)
        ):
            raise WorkerIOError(
                "delete request authorization identity mismatch"
            )
        runtime = _resolve_authority_runtime(
            gate_fd,
            authorization_id=authorization.authorization_id,
            expected_digest=request.expected_maintenance_runtime_digest,
        )
        if (
            authorization.durability_profile.durability_profile_digest
            != request.expected_durability_profile_digest
        ):
            raise DurabilityProfileError(
                "delete request profile does not match authorization"
            )
        _validate_maintenance_profile(
            profile=authorization.durability_profile,
            observation=request.environment_observation,
            runtime=runtime,
            gate_fd=gate_fd,
        )
        _verify_native_helper_identity(helper_path, runtime)
        deleted_value = _read_optional_json_at(
            run_abort_fd,
            "deleted.json",
        )
        if deleted_value is not None:
            event = contracts.AbortSealedAuditEvent.from_dict(
                deleted_value[0]
            )
            if (
                event.event_type is not contracts.AbortEventType.DELETED
                or event.authorization != authorized_event.authorization
                or event.deletion_plan_digest
                != request.deletion_plan_digest
            ):
                raise WorkerIOError("deleted event conflicts with request")
            return _maintenance_result(
                contracts.DeleteTombstoneBatchCompleted,
                identity=request.identity,
                failure_code=None,
                diagnostic=None,
                authorization_id=request.authorization_id,
                attempt_id=request.attempt_id,
                deleted_entries=0,
                deleted_bytes=0,
                continuation_token=None,
                terminal_event_digest=event.event_digest,
            )
        plan_value, plan_bytes = _read_json_at(
            run_abort_fd,
            "deletion-plan.json",
            byte_limit=4 * 1024 * 1024,
        )
        plan = contracts.AbortDeletionPlan.from_dict(plan_value)
        if (
            plan.deletion_plan_digest != request.deletion_plan_digest
            or plan.tombstone_identity_digest
            != request.expected_tombstone_identity_digest
            or hashlib.sha256(plan_bytes).hexdigest()
            != request.deletion_plan_ref.content_sha256
            or request.deletion_plan_ref.evidence_run_id
            != request.evidence_run_id
        ):
            raise WorkerIOError("delete request plan identity mismatch")
        tombstoned = contracts.AbortSealedAuditEvent.from_dict(
            _read_json_at(run_abort_fd, "tombstoned.json")[0]
        )
        candidates = [tombstoned]
        for name in os.listdir(run_abort_fd):
            if name.startswith("failed-") and name.endswith(".json"):
                candidates.append(
                    contracts.AbortSealedAuditEvent.from_dict(
                        _read_json_at(run_abort_fd, name)[0]
                    )
                )
        heads = [
            item
            for item in candidates
            if item.event_digest == request.continuation_event_digest
        ]
        if len(heads) != 1:
            raise WorkerIOError(
                "delete continuation head is absent or ambiguous"
            )
        head = heads[0]
        if (
            head.continuation_token != request.continuation_token
            or head.deletion_plan_digest != plan.deletion_plan_digest
            or head.tombstone_identity_digest
            != plan.tombstone_identity_digest
        ):
            raise WorkerIOError("delete continuation token mismatch")
        start = head.next_traversal_index
        if type(start) is not int or not 0 <= start < len(plan.entries):
            raise WorkerIOError("delete continuation index is invalid")
        end = start
        budget = 0
        while end < len(plan.entries) and end - start < request.entry_limit:
            entry = plan.entries[end]
            projected = (
                budget
                + (
                    entry.byte_length
                    if entry.file_type == "REGULAR_FILE"
                    else 0
                )
            )
            if projected > request.byte_limit:
                break
            budget = projected
            end += 1
        if end == start:
            raise OverflowError(
                "delete byte limit cannot admit next plan entry"
            )
        started_name = f"delete-started-{request.attempt_id}.json"
        existing_started = _read_optional_json_at(
            run_abort_fd,
            started_name,
        )
        root_path = f"aborted-runs/{request.evidence_run_id}"

        def inspect_entry(
            entry: contracts.AbortDeletionPlanEntry,
            *,
            missing_allowed: bool,
        ) -> bool:
            relative = (
                root_path
                if entry.entry_kind == "TOMBSTONE_ROOT"
                else f"{root_path}/{entry.tombstone_relative_path}"
            )
            try:
                opened = _native_openat2_fd(
                    helper_path,
                    gate_fd,
                    relative,
                    expected_type=entry.file_type,
                    deadline=deadline,
                )
            except NativeHelperError:
                try:
                    os.stat(
                        relative,
                        dir_fd=gate_fd,
                        follow_symlinks=False,
                    )
                except FileNotFoundError:
                    if missing_allowed:
                        return False
                raise
            try:
                observed = os.fstat(opened)
                if (
                    str(observed.st_dev) != entry.device_id
                    or str(observed.st_ino) != entry.inode
                    or (
                        entry.file_type == "REGULAR_FILE"
                        and observed.st_size != entry.byte_length
                    )
                ):
                    raise NativeHelperError(
                        "delete entry identity changed"
                    )
                return True
            finally:
                os.close(opened)

        if existing_started is None:
            for entry in plan.entries[start:end]:
                inspect_entry(entry, missing_allowed=False)
            started_event = contracts.AbortSealedAuditEvent.create(
                event_type=contracts.AbortEventType.DELETE_BATCH_STARTED,
                event_sequence=head.event_sequence + 1,
                previous_event_digest=head.event_digest,
                authorization=head.authorization,
                attempt_id=request.attempt_id,
                tombstone_identity_digest=plan.tombstone_identity_digest,
                deletion_plan_ref=request.deletion_plan_ref,
                deletion_plan_digest=plan.deletion_plan_digest,
                completion_source=None,
                batch_end_index_exclusive=end,
                next_traversal_index=start,
                continuation_token=request.continuation_token,
                recorded_at=authorization.authorized_at,
                diagnostic=None,
            )
            _atomic_publish_at(
                run_abort_fd,
                started_name,
                contracts.canonical_json_bytes(started_event.to_dict()),
                profile=authorization.durability_profile,
            )
        else:
            started_event = contracts.AbortSealedAuditEvent.from_dict(
                existing_started[0]
            )
            if (
                started_event.event_type
                is not contracts.AbortEventType.DELETE_BATCH_STARTED
                or started_event.previous_event_digest != head.event_digest
                or started_event.attempt_id != request.attempt_id
                or started_event.next_traversal_index != start
                or started_event.batch_end_index_exclusive != end
                or started_event.continuation_token
                != request.continuation_token
            ):
                raise WorkerIOError(
                    "outstanding delete batch conflicts with request"
                )
            for entry in plan.entries[start:end]:
                inspect_entry(entry, missing_allowed=True)
        for entry in plan.entries[start:end]:
            present = inspect_entry(entry, missing_allowed=True)
            if not present:
                deleted_entries += 1
                if entry.file_type == "REGULAR_FILE":
                    deleted_bytes += entry.byte_length or 0
                continue
            if entry.entry_kind == "TOMBSTONE_ROOT":
                parent_relative = "aborted-runs"
                basename = request.evidence_run_id
            else:
                path = entry.tombstone_relative_path
                parent = posixpath.dirname(path)
                basename = posixpath.basename(path)
                parent_relative = (
                    root_path
                    if not parent
                    else f"{root_path}/{parent}"
                )
            parent_fd = _native_openat2_fd(
                helper_path,
                gate_fd,
                parent_relative,
                expected_type="DIRECTORY",
                deadline=deadline,
            )
            try:
                if entry.file_type == "DIRECTORY":
                    os.rmdir(basename, dir_fd=parent_fd)
                else:
                    os.unlink(basename, dir_fd=parent_fd)
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            deleted_entries += 1
            if entry.file_type == "REGULAR_FILE":
                deleted_bytes += entry.byte_length or 0
        os.fsync(run_abort_fd)
        os.fsync(aborts_fd)
        os.fsync(gate_fd)
        if end == len(plan.entries):
            event = contracts.AbortSealedAuditEvent.create(
                event_type=contracts.AbortEventType.DELETED,
                event_sequence=started_event.event_sequence + 1,
                previous_event_digest=started_event.event_digest,
                authorization=started_event.authorization,
                attempt_id=request.attempt_id,
                tombstone_identity_digest=plan.tombstone_identity_digest,
                deletion_plan_ref=request.deletion_plan_ref,
                deletion_plan_digest=plan.deletion_plan_digest,
                completion_source=(
                    contracts.AbortCompletionSource.DELETE_BATCH_STARTED
                ),
                batch_end_index_exclusive=None,
                next_traversal_index=None,
                continuation_token=None,
                recorded_at=authorization.authorized_at,
                diagnostic=None,
            )
            _atomic_publish_at(
                run_abort_fd,
                "deleted.json",
                contracts.canonical_json_bytes(event.to_dict()),
                profile=authorization.durability_profile,
            )
            return _maintenance_result(
                contracts.DeleteTombstoneBatchCompleted,
                identity=request.identity,
                failure_code=None,
                diagnostic=None,
                authorization_id=request.authorization_id,
                attempt_id=request.attempt_id,
                deleted_entries=deleted_entries,
                deleted_bytes=deleted_bytes,
                continuation_token=None,
                terminal_event_digest=event.event_digest,
            )
        failed_sequence = started_event.event_sequence + 1
        continuation = contracts.abort_continuation_token(
            authorization_id=authorization.authorization_id,
            event_sequence=failed_sequence,
            next_deletion_plan_index=end,
            deletion_plan_digest=plan.deletion_plan_digest,
            tombstone_identity_digest=plan.tombstone_identity_digest,
        )
        event = contracts.AbortSealedAuditEvent.create(
            event_type=contracts.AbortEventType.FAILED,
            event_sequence=failed_sequence,
            previous_event_digest=started_event.event_digest,
            authorization=started_event.authorization,
            attempt_id=request.attempt_id,
            tombstone_identity_digest=plan.tombstone_identity_digest,
            deletion_plan_ref=request.deletion_plan_ref,
            deletion_plan_digest=plan.deletion_plan_digest,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=end,
            continuation_token=continuation,
            recorded_at=authorization.authorized_at,
            diagnostic="authorized deletion batch reached its fixed limit",
        )
        _atomic_publish_at(
            run_abort_fd,
            f"failed-{request.attempt_id}.json",
            contracts.canonical_json_bytes(event.to_dict()),
            profile=authorization.durability_profile,
        )
        return _maintenance_result(
            contracts.DeleteTombstoneBatchIncomplete,
            identity=request.identity,
            failure_code=contracts.MaintenanceFailureCode.LIMIT_EXCEEDED,
            diagnostic="authorized deletion batch reached its fixed limit",
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            deleted_entries=deleted_entries,
            deleted_bytes=deleted_bytes,
            continuation_token=continuation,
            terminal_event_digest=event.event_digest,
        )
    except BaseException as error:
        diagnostic = (
            f"{type(error).__name__}: {error}"[:4096]
            or "delete tombstone batch failed"
        )
        if started_event is None:
            return _maintenance_result(
                contracts.DeleteTombstoneBatchRejected,
                identity=request.identity,
                failure_code=(
                    contracts.MaintenanceFailureCode
                    .DURABILITY_PROFILE_UNSUPPORTED
                    if isinstance(
                        error,
                        (DurabilityProfileError, NativeHelperError),
                    )
                    else _maintenance_rejection_code(error)
                ),
                diagnostic=diagnostic,
                authorization_id=request.authorization_id,
                attempt_id=request.attempt_id,
                deleted_entries=0,
                deleted_bytes=0,
                continuation_token=None,
                terminal_event_digest=None,
            )
        # A started batch must close with a durable FAILED event. If that
        # publication itself fails, propagate so the supervisor reports a
        # process/protocol failure rather than a false NO_MUTATION result.
        plan_value = contracts.AbortDeletionPlan.from_dict(
            _read_json_at(run_abort_fd, "deletion-plan.json")[0]
        )
        next_index = (
            started_event.next_traversal_index + deleted_entries
        )
        sequence = started_event.event_sequence + 1
        continuation = contracts.abort_continuation_token(
            authorization_id=request.authorization_id,
            event_sequence=sequence,
            next_deletion_plan_index=next_index,
            deletion_plan_digest=plan_value.deletion_plan_digest,
            tombstone_identity_digest=(
                plan_value.tombstone_identity_digest
            ),
        )
        failure_event = contracts.AbortSealedAuditEvent.create(
            event_type=contracts.AbortEventType.FAILED,
            event_sequence=sequence,
            previous_event_digest=started_event.event_digest,
            authorization=started_event.authorization,
            attempt_id=request.attempt_id,
            tombstone_identity_digest=(
                plan_value.tombstone_identity_digest
            ),
            deletion_plan_ref=request.deletion_plan_ref,
            deletion_plan_digest=plan_value.deletion_plan_digest,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=next_index,
            continuation_token=continuation,
            recorded_at=started_event.recorded_at,
            diagnostic=diagnostic,
        )
        _atomic_publish_at(
            run_abort_fd,
            f"failed-{request.attempt_id}.json",
            contracts.canonical_json_bytes(failure_event.to_dict()),
            profile=started_event.authorization.durability_profile,
        )
        return _maintenance_result(
            contracts.DeleteTombstoneBatchFailed,
            identity=request.identity,
            failure_code=(
                contracts.MaintenanceFailureCode.IO_FAILED
            ),
            diagnostic=diagnostic,
            authorization_id=request.authorization_id,
            attempt_id=request.attempt_id,
            deleted_entries=deleted_entries,
            deleted_bytes=deleted_bytes,
            continuation_token=continuation,
            terminal_event_digest=failure_event.event_digest,
        )
    finally:
        for descriptor in (
            run_abort_fd,
            aborts_fd,
            abort_lock,
            publish_lock,
            cleanup_lock,
        ):
            if descriptor >= 0:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                except OSError:
                    pass
                os.close(descriptor)


def _native_openat2_fd(
    helper_path: str,
    gate_fd: int,
    relative_path: str,
    *,
    expected_type: str,
    deadline: float,
) -> int:
    if (
        type(helper_path) is not str
        or not os.path.isabs(helper_path)
        or os.path.realpath(helper_path) != helper_path
        or expected_type not in {"DIRECTORY", "REGULAR_FILE", "ANY"}
    ):
        raise NativeHelperError("native helper invocation is invalid")
    contracts.validate_repo_relative_path(relative_path)
    parent, child = socket.socketpair(
        socket.AF_UNIX,
        socket.SOCK_DGRAM,
    )
    pid = os.fork()
    if pid == 0:
        try:
            parent.close()
            if gate_fd != 3:
                os.dup2(gate_fd, 3)
            if child.fileno() != 4:
                os.dup2(child.fileno(), 4)
            fcntl.fcntl(3, fcntl.F_SETFD, 0)
            fcntl.fcntl(4, fcntl.F_SETFD, 0)
            maximum = os.sysconf("SC_OPEN_MAX")
            os.closerange(5, maximum)
            os.execve(
                helper_path,
                [
                    helper_path,
                    "--openat2-fd",
                    "3",
                    "4",
                    relative_path,
                    expected_type,
                ],
                {"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"},
            )
        except BaseException:
            os._exit(127)
    child.close()
    received_fd = -1
    status = None
    try:
        parent.setblocking(False)
        while time.monotonic() < deadline:
            try:
                message, ancillary, flags, _ = parent.recvmsg(
                    1,
                    socket.CMSG_SPACE(array.array("i", [0]).itemsize),
                )
                if flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
                    raise NativeHelperError(
                        "native helper descriptor response was truncated"
                    )
                descriptors = []
                for level, kind, data in ancillary:
                    if (
                        level != socket.SOL_SOCKET
                        or kind != socket.SCM_RIGHTS
                    ):
                        raise NativeHelperError(
                            "native helper sent unexpected ancillary data"
                        )
                    values = array.array("i")
                    values.frombytes(
                        data[: len(data) - (len(data) % values.itemsize)]
                    )
                    descriptors.extend(values)
                if message != b"\x01" or len(descriptors) != 1:
                    _close_descriptors(descriptors)
                    raise NativeHelperError(
                        "native helper descriptor response is invalid"
                    )
                received_fd = descriptors[0]
                fcntl.fcntl(received_fd, fcntl.F_SETFD, fcntl.FD_CLOEXEC)
                break
            except BlockingIOError:
                time.sleep(0.005)
        if received_fd < 0:
            raise TimeoutError("native openat2 helper deadline expired")
    finally:
        parent.close()
        while True:
            observed, child_status = os.waitpid(pid, os.WNOHANG)
            if observed == pid:
                status = child_status
                break
            if time.monotonic() >= deadline:
                os.kill(pid, signal.SIGKILL)
                _, status = os.waitpid(pid, 0)
                break
            time.sleep(0.005)
    if (
        status is None
        or not os.WIFEXITED(status)
        or os.WEXITSTATUS(status) != 0
    ):
        if received_fd >= 0:
            os.close(received_fd)
        raise NativeHelperError("native openat2 helper exited unsuccessfully")
    observed = os.fstat(received_fd)
    if (
        expected_type == "DIRECTORY"
        and not stat.S_ISDIR(observed.st_mode)
    ) or (
        expected_type == "REGULAR_FILE"
        and not stat.S_ISREG(observed.st_mode)
    ) or (
        expected_type == "ANY"
        and not (
            stat.S_ISDIR(observed.st_mode)
            or stat.S_ISREG(observed.st_mode)
        )
    ):
        os.close(received_fd)
        raise NativeHelperError("native helper returned wrong file type")
    return received_fd


def _verify_process_contract(control_fd: int, descriptor_fd: int | None) -> int:
    if os.getpid() != os.getpgrp():
        raise WorkerIOError("worker must own its process group")
    if signal.getsignal(signal.SIGALRM) != signal.SIG_DFL:
        raise WorkerIOError("worker SIGALRM disposition is not default")
    remaining, interval = signal.getitimer(signal.ITIMER_REAL)
    if not 0 < remaining <= contracts.FINALIZER_TIMEOUT_SECONDS_MAX or interval != 0:
        raise WorkerIOError("worker hard timer is absent or periodic")
    allowed = {0, 1, 2, control_fd}
    if descriptor_fd is not None:
        allowed.add(descriptor_fd)
    maximum = os.sysconf("SC_OPEN_MAX")
    for descriptor in range(3, maximum):
        if descriptor in allowed:
            continue
        try:
            fcntl.fcntl(descriptor, fcntl.F_GETFD)
        except OSError:
            continue
        raise WorkerIOError("worker inherited an undeclared descriptor")
    return int(remaining * 1_000_000)


def _ready_frame(
    identity: contracts.WorkerRequestIdentity,
    remaining_micros: int,
) -> contracts.WorkerReadyFrame:
    digests = tuple(
        claim.descriptor_claim_digest for claim in identity.descriptor_claims
    )
    payload = {
        "frameType": "WORKER_READY",
        "identity": identity.to_dict(),
        "validatedDescriptorClaimDigests": list(digests),
        "timerRemainingMicros": remaining_micros,
    }
    return contracts.WorkerReadyFrame(
        identity,
        digests,
        remaining_micros,
        contracts.domain_separated_sha256(
            "pt.acceptance.finalization.supervisor-control-frame.v1", payload
        ),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--control-fd", type=int, required=True)
    parser.add_argument("--descriptor-fd", type=int)
    parser.add_argument("--supervisor-session-id", required=True)
    parser.add_argument("--supervisor-runtime-digest", required=True)
    parser.add_argument("--native-helper-path", required=True)
    arguments = parser.parse_args(argv)
    contracts.validate_sha256(arguments.supervisor_runtime_digest)
    if (
        not os.path.isabs(arguments.native_helper_path)
        or os.path.realpath(arguments.native_helper_path)
        != arguments.native_helper_path
    ):
        raise WorkerIOError("native helper path must be canonical absolute")
    remaining_micros = _verify_process_contract(
        arguments.control_fd, arguments.descriptor_fd
    )
    control_socket = socket.socket(fileno=arguments.control_fd)
    channel = ControlChannel(control_socket)
    deadline = time.monotonic() + min(
        contracts.FINALIZER_TIMEOUT_SECONDS_MAX,
        max(0.001, remaining_micros / 1_000_000),
    )
    frame = channel.receive(deadline=deadline)
    if type(frame) is not contracts.WorkerRequestFrame:
        raise WorkerIOError("worker expected one concrete request frame")
    request = frame.request
    if request.identity.supervisor_session_id != arguments.supervisor_session_id:
        raise WorkerIOError("request belongs to another supervisor session")
    descriptors: tuple[int, ...] = ()
    descriptor_socket = None
    try:
        if request.identity.descriptor_claims:
            if arguments.descriptor_fd is None:
                raise WorkerIOError("worker request requires descriptor channel")
            descriptor_socket = socket.socket(fileno=arguments.descriptor_fd)
            descriptors = receive_descriptors(
                descriptor_socket, request.identity, deadline=deadline
            )
        elif arguments.descriptor_fd is not None:
            raise WorkerIOError("descriptor-free worker received descriptor channel")
        channel.send(
            _ready_frame(request.identity, remaining_micros),
            deadline=deadline,
        )
        if type(request) is contracts.PersistAuthorityRuntimeRequest:
            mutation_state = [False]
            try:
                result = _persist_authority_runtime_result(
                    request,
                    descriptors[0],
                    descriptors[1],
                    deadline=deadline,
                    mutation_state=mutation_state,
                )
            except BaseException as error:
                result = _persist_authority_runtime_failure(
                    request,
                    error,
                    mutation_attempted=mutation_state[0],
                )
        elif type(request) is contracts.PrepareBundleRequest:
            try:
                result = _bundle_result(
                    request, descriptors[0], descriptors[1], deadline=deadline
                )
            except BaseException as error:
                result = _bundle_failure(request, error)
        elif type(request) is contracts.MaterializeSnapshotRequest:
            try:
                result = _materialize_result(
                    request, descriptors[0], deadline=deadline
                )
            except BaseException as error:
                result = _materialize_failure(request, error)
        elif type(request) is contracts.CaptureRuntimeRequest:
            try:
                result = _runtime_capture_result(request, descriptors[0])
            except BaseException as error:
                result = _runtime_capture_failure(request, error)
        elif type(request) is contracts.ExecuteFinalizerRequest:
            try:
                result = _execute_finalizer_result(
                    request,
                    supervisor_session_id=arguments.supervisor_session_id,
                    supervisor_runtime_digest=arguments.supervisor_runtime_digest,
                    deadline=deadline,
                )
            except BaseException as error:
                result = _execute_finalizer_failure(request, error)
        elif type(request) is contracts.InstallPublicationInterlockRequest:
            result = _install_interlock_result(
                request,
                descriptors[0],
                deadline=deadline,
            )
        elif type(request) is contracts.ActivateEnforcementRequest:
            result = _activate_enforcement_result(
                request,
                descriptors[0],
                deadline=deadline,
            )
        elif type(request) is contracts.WriteAbortEventRequest:
            result = _write_abort_authorization_result(
                request,
                descriptors[0],
                deadline=deadline,
            )
        elif type(request) is contracts.TombstoneRunRequest:
            result = _tombstone_run_result(
                request,
                descriptors[0],
                helper_path=arguments.native_helper_path,
                deadline=deadline,
            )
        elif type(request) is contracts.DeleteTombstoneBatchRequest:
            result = _delete_tombstone_batch_result(
                request,
                descriptors[0],
                helper_path=arguments.native_helper_path,
                deadline=deadline,
            )
        else:
            raise WorkerIOError("worker kind has no implemented isolated dispatcher")
        channel.send(_worker_result_frame(request, result), deadline=deadline)
        return 0
    finally:
        _close_descriptors(list(descriptors))
        if descriptor_socket is not None:
            descriptor_socket.close()
        control_socket.close()


if __name__ == "__main__":
    raise SystemExit(main())
