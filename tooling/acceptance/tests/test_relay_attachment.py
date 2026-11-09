"""Shared Relay preparation and actual emitted cleanup-script regressions."""
import hashlib
import os
import subprocess
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.provisioners import relay_attachment as owner_module

CA_SCRIPT_PREFIX = """
sha256sum() { python3 -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()+"  "+sys.argv[1])' "$1"; }
stat() { python3 -c 'import os,stat,sys; s=os.lstat(sys.argv[1]); print(str(oct(stat.S_IMODE(s.st_mode))[2:])+":"+str(s.st_uid))' "$3"; }
update-ca-certificates() { :; }
"""


class RelayAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.callbacks = []
        self.owner = owner_module.RelayAttachmentFixture(
            register_cleanup=lambda name, callback: self.callbacks.append((name, callback)),
        )
        self.arguments = dict(
            manifest=types.SimpleNamespace(run_id="run-1"),
            station_url="http://station.invalid", relay_url="https://relay.invalid",
            relay_peer_id="relay-peer", relay_config=object(), trust_anchor=b"certificate",
        )

    def test_preexisting_active_is_reused_without_acquiring_cleanup_ownership(self):
        current = {"relay_peer_id": "relay-peer", "control_origin": "https://relay.invalid",
                   "state": "active", "enabled": True}
        with patch.object(self.owner, "dashboard_token", return_value="token"), patch.object(
            self.owner, "attachment_items", return_value=[current],
        ), patch.object(owner_module, "relay_json_request") as request:
            self.assertEqual(current, self.owner.ensure_attachment(**self.arguments))
        self.assertEqual([], self.callbacks)
        request.assert_not_called()

    def test_preexisting_nonactive_or_foreign_origin_remains_untouched(self):
        for state, origin in (("recovering", "https://relay.invalid"),
                              ("active", "https://foreign.invalid")):
            current = {"relay_peer_id": "relay-peer", "control_origin": origin,
                       "state": state, "enabled": True}
            with patch.object(self.owner, "dashboard_token", return_value="token"), patch.object(
                self.owner, "attachment_items", return_value=[current],
            ), patch.object(owner_module, "relay_json_request") as request:
                with self.assertRaises(owner_module.BlockedError):
                    self.owner.ensure_attachment(**self.arguments)
            self.assertEqual([], self.callbacks)
            request.assert_not_called()

    def test_unknown_import_outcome_has_both_cleanup_owners_before_mutation(self):
        original = RuntimeError("unknown import outcome")
        labels = []

        def request(url, **arguments):
            if url.endswith("/relay/invite"):
                self.assertEqual(1, len(self.callbacks))
                label = arguments["body"]["label"]
                labels.append(label)
                return 200, {"invitation": {
                    "relay_peer_id": "relay-peer", "control_origin": "https://relay.invalid",
                    "intended_station_peer_id": "station-peer", "label": label,
                    "invite_token": "private-invite",
                }}
            self.assertEqual(2, len(self.callbacks))
            raise original

        with patch.object(self.owner, "dashboard_token", return_value="token"), patch.object(
            self.owner, "attachment_items", return_value=[],
        ), patch.object(owner_module, "read_service_runtime_identity", return_value="station-peer"), patch.object(
            owner_module, "mint_posix_relay_operator_token", return_value="operator-token",
        ), patch.object(owner_module, "relay_json_request", side_effect=request):
            with self.assertRaises(RuntimeError) as caught:
                self.owner.ensure_attachment(**self.arguments)
        self.assertIs(original, caught.exception)
        self.assertEqual(1, len(labels))
        self.assertTrue(self.callbacks[0][0].startswith("relay-invitation:"))
        self.assertTrue(self.callbacks[1][0].startswith("relay-attachment:"))

    def test_cleanup_refuses_a_replaced_attachment(self):
        foreign = {"relay_peer_id": "relay-peer", "label": "operator",
                   "control_origin": "https://relay.invalid"}
        with patch.object(self.owner, "dashboard_token", return_value="token"), patch.object(
            self.owner, "attachment_items", return_value=[foreign],
        ), patch.object(owner_module, "read_service_runtime_identity", return_value="station-peer"), patch.object(
            owner_module, "relay_json_request",
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "does not own"):
                self.owner._detach("http://station.invalid", "relay-peer", label="ours",
                                   control_origin="https://relay.invalid", station_peer_id="station-peer")
        request.assert_not_called()

    def test_unconsumed_invitation_is_closed_by_original_api_and_read_back(self):
        invite = {"id": "42", "label": "ours", "intended_station_peer_id": "station-peer", "status": 1}
        with patch.object(owner_module, "mint_posix_relay_operator_token", return_value="token"), patch.object(
            owner_module, "relay_json_request", side_effect=[
                (200, {"invites": [invite]}), (200, {"status": "deleted"}), (200, {"invites": []}),
            ],
        ) as request:
            self.owner._close_invite("https://relay.invalid", label="ours",
                                    station_peer_id="station-peer", relay_config=object(), trust_anchor=b"ca")
        self.assertEqual("DELETE", request.call_args_list[1].kwargs["method"])
        self.assertEqual({"invite_id": "42"}, request.call_args_list[1].kwargs["body"])
        self.assertEqual(3, request.call_count)

    def test_ca_cleanup_is_registered_before_unknown_write_result(self):
        transport = Mock()
        timeout = subprocess.TimeoutExpired("docker", 30)
        transport.run_argv.side_effect = [
            subprocess.CompletedProcess([], 0, "", ""), timeout,
            subprocess.CompletedProcess([], 0, "", ""),
        ]
        config = types.SimpleNamespace(environment_name="station-dev", transport=lambda: transport,
                                       compose_project="station-dev", compose_service="station")
        with patch.object(self.owner, "wait_runtime", return_value={"containerId": "original"}):
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                self.owner.install_station_ca(config, b"certificate", run_id="run-1")
            self.assertIs(timeout, caught.exception)
            self.assertEqual(1, len(self.callbacks))
            self.callbacks[0][1]()
        commands = [call.args[0] for call in transport.run_argv.call_args_list]
        self.assertNotIn("ncp-relay-acceptance.crt", repr(commands))
        self.assertEqual("original", commands[-1][4])
        self.assertEqual(owner_module._BOUND_CA_CLEANUP, commands[-1][2])

    def test_cleanup_mutation_precedes_post_restart_health_check(self):
        transport = Mock()
        transport.run_argv.return_value = subprocess.CompletedProcess([], 0, "", "")
        config = types.SimpleNamespace(environment_name="station-dev", transport=lambda: transport,
                                       compose_project="station-dev", compose_service="station")
        events = []

        def ready(config):
            events.append("healthy-read")
            return {"containerId": "original"}

        with patch.object(self.owner, "wait_runtime", side_effect=ready):
            self.owner.install_station_ca(config, b"certificate", run_id="run-1")
            events.clear()
            transport.run_argv.side_effect = lambda *args, **kwargs: (
                events.append(tuple(args[0][:3])), subprocess.CompletedProcess([], 0, "", ""),
            )[1]
            self.callbacks[0][1]()
        self.assertEqual([
            ("sh", "-ceu", owner_module._BOUND_CA_CLEANUP), "healthy-read",
        ], events)

    def test_actual_cleanup_refuses_replacement_before_trust_mutation(self):
        script = r"""
docker() {
  case "$1" in
    ps) printf '%s\n' "$OBSERVED_CONTAINER" ;;
    exec) printf 'remove\n' >> "$ACTION_FILE" ;;
    restart) printf 'restart\n' >> "$ACTION_FILE" ;;
    *) exit 29 ;;
  esac
}
""" + owner_module._BOUND_CA_CLEANUP
        with tempfile.TemporaryDirectory() as directory:
            action_file = Path(directory) / "actions"
            environment = {**os.environ, "ACTION_FILE": str(action_file)}
            arguments = ["--", "original", "project", "station", "inner", "final", "partial", "digest"]
            for observed in ("replacement", "original\nreplacement"):
                completed = subprocess.run(
                    ["/bin/bash", "-ceu", script, *arguments], capture_output=True,
                    env={**environment, "OBSERVED_CONTAINER": observed},
                )
                self.assertEqual(26, completed.returncode)
                self.assertFalse(action_file.exists())
            subprocess.run(
                ["/bin/bash", "-ceu", script, *arguments], capture_output=True, check=True,
                env={**environment, "OBSERVED_CONTAINER": "original"},
            )
            self.assertEqual("remove\nrestart\n", action_file.read_text())

    def test_actual_ca_scripts_preserve_foreign_files_and_refuse_changed_final_bytes(self):
        # Execute the emitted scripts, adapting only host utility spelling.
        prefix = CA_SCRIPT_PREFIX
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            foreign, final, partial = root / "operator.crt", root / "ours.crt", root / "ours.partial"
            foreign.write_bytes(b"operator")
            digest = hashlib.sha256(b"certificate").hexdigest()
            args = ["--", str(final), str(partial), digest]
            subprocess.run(["/bin/bash", "-ceu", prefix + owner_module._INSTALL_CA, *args],
                           input="certificate", text=True, check=True, capture_output=True)
            self.assertEqual(b"certificate", final.read_bytes())
            self.assertFalse(partial.exists())
            final.write_bytes(b"replaced")
            rejected = subprocess.run(["/bin/bash", "-ceu", prefix + owner_module._REMOVE_CA, *args],
                                      text=True, capture_output=True)
            self.assertNotEqual(0, rejected.returncode)
            self.assertEqual(b"replaced", final.read_bytes())
            self.assertEqual(b"operator", foreign.read_bytes())
            final.write_bytes(b"certificate")
            subprocess.run(["/bin/bash", "-ceu", prefix + owner_module._REMOVE_CA, *args],
                           text=True, check=True, capture_output=True)
            self.assertFalse(final.exists())
            self.assertEqual(b"operator", foreign.read_bytes())

    def test_actual_partial_write_cleanup_admits_empty_files_and_refuses_foreign_types(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            final, partial, foreign = root / "ours.crt", root / "ours.partial", root / "operator.crt"
            foreign.write_bytes(b"operator")
            args = ["--", str(final), str(partial), hashlib.sha256(b"certificate").hexdigest()]
            for body in (b"", b"partial-certificate"):
                partial.write_bytes(body)
                partial.chmod(0o600)
                subprocess.run(
                    ["/bin/bash", "-ceu", CA_SCRIPT_PREFIX + owner_module._REMOVE_CA, *args],
                    capture_output=True, check=True,
                )
                self.assertFalse(partial.exists())
            partial.symlink_to(foreign)
            rejected = subprocess.run(
                ["/bin/bash", "-ceu", CA_SCRIPT_PREFIX + owner_module._REMOVE_CA, *args],
                capture_output=True,
            )
            self.assertEqual(23, rejected.returncode)
            self.assertEqual(b"operator", foreign.read_bytes())
            partial.unlink()
            partial.mkdir()
            rejected = subprocess.run(
                ["/bin/bash", "-ceu", CA_SCRIPT_PREFIX + owner_module._REMOVE_CA, *args],
                capture_output=True,
            )
            self.assertEqual(24, rejected.returncode)
            self.assertTrue(partial.is_dir())


if __name__ == "__main__":
    unittest.main()
