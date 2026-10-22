"""Real POSIX socket and filesystem checks for D-19 bounded worker I/O."""

from __future__ import annotations

import array
import fcntl
import hashlib
import os
import socket
import struct
import tempfile
import threading
import time
import unittest
from pathlib import Path

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core import finalizer_worker as worker


def signed(payload):
    return {
        **payload, "frameDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.supervisor-control-frame.v1", payload
        ),
    }


class FinalizerWorkerIOTests(unittest.TestCase):
    def deadline(self):
        return time.monotonic() + 2

    def pair(self, kind=socket.SOCK_STREAM):
        first, second = socket.socketpair(socket.AF_UNIX, kind)
        self.addCleanup(first.close)
        self.addCleanup(second.close)
        return first, second

    def identity(self, fd):
        observed = os.fstat(fd)
        return contracts.WorkerRequestIdentity.create(
            supervisor_session_id="session", request_id="request", sequence=1,
            worker_kind=contracts.WorkerKind.RUNTIME_CAPTURE,
            descriptor_claims=(contracts.DescriptorClaim.create(
                device_id=str(observed.st_dev), inode=str(observed.st_ino),
                owner_binding=contracts.TemporaryDirectoryOwnerBinding(
                    "session", "request", "nonce"
                ),
            ),), request_payload_digest="a" * 64,
        )

    def directory(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        fd = os.open(directory.name, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        return Path(directory.name), fd

    def ready(self):
        return contracts.supervisor_control_frame_from_bytes(
            contracts.canonical_json_bytes(signed({
                "frameType": "SUPERVISOR_READY", "supervisorSessionId": "session",
                "supervisorRuntimeDigest": "a" * 64, "protocolVersion": 1,
            }))
        )

    def test_control_channel_handles_partial_and_coalesced_frames(self):
        sender, receiver = self.pair()
        wire = contracts.canonical_json_bytes(self.ready().to_dict())
        packet = struct.pack(">I", len(wire)) + wire
        errors = []

        def send():
            try:
                for part in (packet[:1], packet[1:3], packet[3:8], packet[8:] + packet):
                    sender.sendall(part)
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=send)
        thread.start()
        channel = worker.ControlChannel(receiver)
        self.assertEqual(channel.receive(deadline=self.deadline()), self.ready())
        self.assertEqual(channel.receive(deadline=self.deadline()), self.ready())
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])

    def test_control_channel_rejects_bounds_truncation_and_noncanonical_json(self):
        canonical = contracts.canonical_json_bytes(self.ready().to_dict())
        malformed = (
            struct.pack(">I", 0),
            struct.pack(">I", worker.STREAM_LIMIT + 1),
            b"\x00\x00",
            struct.pack(">I", len(canonical)) + canonical[:-1],
            struct.pack(">I", 7) + b'{"x":1}',
            struct.pack(">I", len(canonical) + 1) + canonical + b" ",
            struct.pack(">I", 13) + b'{"x":1,"x":2}',
        )
        for packet in malformed:
            with self.subTest(packet=packet[:8]):
                sender, receiver = self.pair()
                sender.sendall(packet)
                sender.shutdown(socket.SHUT_WR)
                channel = worker.ControlChannel(receiver)
                with self.assertRaises(ValueError):
                    channel.receive(deadline=self.deadline())
                self.assertEqual(receiver.fileno(), -1)

    def test_control_channel_send_and_timeout_close(self):
        sender, receiver = self.pair()
        worker.ControlChannel(sender).send(self.ready(), deadline=self.deadline())
        self.assertEqual(
            worker.ControlChannel(receiver).receive(deadline=self.deadline()), self.ready()
        )
        with self.assertRaises(TimeoutError):
            worker.ControlChannel(receiver).receive(deadline=time.monotonic())
        self.assertEqual(receiver.fileno(), -1)

    def test_descriptor_transfer_identity_cloexec_and_acceptance_lifetime(self):
        _, fd = self.directory()
        identity = self.identity(fd)
        sender, receiver = self.pair(socket.SOCK_DGRAM)
        transfer = worker.DescriptorSend(identity, (fd,))
        self.addCleanup(transfer.close)
        transfer.send(sender, deadline=self.deadline())
        duplicates = tuple(transfer.duplicates)
        accepted = worker.receive_descriptors(receiver, identity, deadline=self.deadline())
        for received in accepted:
            self.addCleanup(os.close, received)
            self.assertTrue(fcntl.fcntl(received, fcntl.F_GETFD) & fcntl.FD_CLOEXEC)
            self.assertEqual(os.fstat(received).st_ino, os.fstat(fd).st_ino)
        self.assertEqual(len(transfer.duplicates), 1)
        frame = contracts.supervisor_control_frame_from_bytes(
            contracts.canonical_json_bytes(signed({
                "frameType": "REQUEST_ACCEPTED", "identity": identity.to_dict(),
                "acceptedDescriptorClaimDigests": [
                    claim.descriptor_claim_digest for claim in identity.descriptor_claims
                ],
            }))
        )
        transfer.accept(frame)
        self.assertEqual(transfer.duplicates, [])
        for duplicate in duplicates:
            with self.assertRaises(OSError):
                os.fstat(duplicate)
        self.assertTrue(os.fstat(fd))

    def test_descriptor_transfer_rejects_replay_before_acceptance(self):
        _, fd = self.directory()
        sender, _ = self.pair(socket.SOCK_DGRAM)
        transfer = worker.DescriptorSend(self.identity(fd), (fd,))
        self.addCleanup(transfer.close)
        transfer.send(sender, deadline=self.deadline())
        with self.assertRaisesRegex(ValueError, "already sent"):
            transfer.send(sender, deadline=self.deadline())

    def test_descriptor_receiver_rejects_wrong_identity_count_and_permissions(self):
        directory, fd = self.directory()
        identity = self.identity(fd)
        for case in ("identity", "count", "permissions", "truncated"):
            with self.subTest(case=case):
                sender, receiver = self.pair(socket.SOCK_DGRAM)
                sender.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 16384)
                receiver.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 16384)
                wire = contracts.canonical_json_bytes(signed({
                    "frameType": "DESCRIPTOR_TRANSFER", "identity": identity.to_dict(),
                    "descriptorClaimDigests": [
                        claim.descriptor_claim_digest for claim in identity.descriptor_claims
                    ],
                }))
                if case == "identity":
                    wire = wire.replace(b'"request"', b'"another"')
                elif case == "permissions":
                    directory.chmod(0o777)
                elif case == "truncated":
                    wire += b" " * worker.DATAGRAM_LIMIT
                fds = (fd, fd) if case == "count" else (fd,)
                sender.sendmsg([wire], [
                    (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", fds))
                ])
                with self.assertRaises(ValueError):
                    worker.receive_descriptors(receiver, identity, deadline=self.deadline())
                self.assertEqual(receiver.fileno(), -1)
                directory.chmod(0o700)
                self.assertTrue(os.fstat(fd))

    def test_capture_sources_is_anchored_and_hash_bound(self):
        directory, fd = self.directory()
        (directory / "nested").mkdir()
        content = b"reviewed-source\n"
        (directory / "nested" / "source.py").write_bytes(content)
        digest = hashlib.sha256(content).hexdigest()
        captured = worker.capture_sources(
            fd, (("nested/source.py", digest),), deadline=self.deadline()
        )
        self.assertEqual(captured, (worker.CapturedSource("nested/source.py", digest, content),))
        with self.assertRaisesRegex(ValueError, "reviewed hash"):
            worker.capture_sources(fd, (("nested/source.py", "a" * 64),), deadline=self.deadline())
        with self.assertRaises(TimeoutError):
            worker.capture_sources(fd, (("nested/source.py", digest),), deadline=time.monotonic())
        (directory / "link").symlink_to(directory / "nested", target_is_directory=True)
        with self.assertRaises(OSError):
            worker.capture_sources(fd, (("link/source.py", digest),), deadline=self.deadline())
        (directory / "final.py").symlink_to(directory / "nested" / "source.py")
        with self.assertRaises(OSError):
            worker.capture_sources(fd, (("final.py", digest),), deadline=self.deadline())
        os.mkfifo(directory / "fifo")
        with self.assertRaisesRegex(ValueError, "regular file"):
            worker.capture_sources(fd, (("fifo", digest),), deadline=self.deadline())

    def test_source_bundle_has_exact_canonical_bytes_and_rejects_mutations(self):
        content = b"source"
        digest = hashlib.sha256(content).hexdigest()
        sources = (worker.CapturedSource("source.py", digest, content),)
        manifest = contracts.canonical_json_bytes([{
            "repoRelativePath": "source.py", "fileSha256": digest, "byteLength": len(content),
        }])
        expected = (
            b"pt-finalizer-bundle-v1" + struct.pack(">Q", len(manifest)) + manifest
            + struct.pack(">Q", len(content)) + content
        )
        self.assertEqual(worker.encode_source_bundle(sources), expected)
        self.assertEqual(worker.decode_source_bundle(expected), sources)
        mutations = (
            b"", expected[:-1], expected + b"x", expected[:-1] + b"x",
            worker.BUNDLE_MAGIC + struct.pack(">Q", worker.MANIFEST_LIMIT + 1),
            expected.replace(b"source.py", b"../bad.py"),
        )
        for mutated in mutations:
            with self.subTest(prefix=mutated[:32]):
                with self.assertRaises(ValueError):
                    worker.decode_source_bundle(mutated)
        with self.assertRaisesRegex(ValueError, "unique and sorted"):
            worker.encode_source_bundle(sources + sources)
        with self.assertRaisesRegex(ValueError, "hash/length"):
            worker.encode_source_bundle((worker.CapturedSource("source.py", "a" * 64, content),))

    def test_bundle_failure_preserves_timeout_ownership(self):
        payload = {
            "sourceInventory": [["source/main.py", "c" * 64]],
            "entrypoint": "source.main",
            "fileLimit": 64,
            "pathByteLimit": 512,
            "manifestByteLimit": 256 * 1024,
            "entryByteLimit": 8 * 1024 * 1024,
            "bundleByteLimit": 64 * 1024 * 1024,
            "expandedByteLimit": 64 * 1024 * 1024,
            "temporaryStorageByteLimit": 128 * 1024 * 1024,
            "timeoutSeconds": 60,
        }
        owners = (
            contracts.RepositoryRootOwnerBinding(
                "0123456789abcdef", "commit", "a" * 64, "b" * 64
            ),
            contracts.TemporaryDirectoryOwnerBinding("session", "request", "nonce"),
        )
        identity = contracts.WorkerRequestIdentity.create(
            supervisor_session_id="session",
            request_id="request",
            sequence=1,
            worker_kind=contracts.WorkerKind.BUNDLE_PREPARER,
            descriptor_claims=tuple(
                contracts.DescriptorClaim.create(
                    device_id="1", inode=str(index + 2), owner_binding=owner
                )
                for index, owner in enumerate(owners)
            ),
            request_payload_digest=contracts.domain_separated_sha256(
                "pt.acceptance.finalization.worker-request.v1", payload
            ),
        )
        request = contracts.PrepareBundleRequest.from_dict(
            {"identity": identity.to_dict(), **payload}
        )
        result = worker._bundle_failure(request, TimeoutError("deadline expired"))
        self.assertIs(result.failure_code, contracts.FinalizerFailureCode.TIMED_OUT)


if __name__ == "__main__":
    unittest.main()
