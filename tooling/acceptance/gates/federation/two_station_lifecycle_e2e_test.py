from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat.mixed_native_runtime import (
    MixedNativeRuntime,
)
from tooling.acceptance.gates.federation.two_station_lifecycle_e2e import (
    FederationTwoStationLifecycleGate,
    RUNTIME_REUSE_CONTRACT,
    SCENARIO_IDS,
)


class FederationTwoStationLifecycleGateTest(unittest.TestCase):
    def test_opens_single_section_federation_group_without_sidebar_item(
        self,
    ) -> None:
        gate = object.__new__(FederationTwoStationLifecycleGate)
        gate.runtime = MagicMock()
        gate.runtime.wait_until.side_effect = (
            lambda predicate, _description, *, timeout_seconds: predicate()
        )
        session = MagicMock()
        primary = MagicMock()
        primary.is_displayed.return_value = True
        secondary = MagicMock()
        secondary.is_displayed.return_value = True
        section = MagicMock()
        section.is_displayed.return_value = True
        elements = {
            '[data-pt-primary-nav="settings"] [role="button"]': [primary],
            '[data-pt-secondary-tab="federation"]': [secondary],
            '[data-pt-section-host="federation"]': [section],
        }
        session.find_elements.side_effect = elements.__getitem__

        gate._open_federation_settings(session)

        primary.click.assert_called_once_with()
        secondary.click.assert_called_once_with()
        section.click.assert_not_called()
        session.find_element.assert_not_called()

    def test_selects_only_visible_elements_from_cached_sections(self) -> None:
        hidden = MagicMock()
        hidden.is_displayed.return_value = False
        visible = MagicMock()
        visible.is_displayed.return_value = True
        session = MagicMock()
        session.find_elements.return_value = [hidden, visible]

        selected = FederationTwoStationLifecycleGate._visible_element(
            session,
            '[data-federation-context-id="fed-1"]',
        )

        self.assertIs(selected, visible)

    def test_visible_context_uses_stage_specific_evidence_names(self) -> None:
        gate = object.__new__(FederationTwoStationLifecycleGate)
        gate.runtime = MagicMock()
        gate.runtime.wait_until.side_effect = (
            lambda predicate, _description, *, timeout_seconds: predicate()
        )
        session = MagicMock()
        session.find_elements.return_value = []
        gate.runtime.desktop_session.return_value = session
        gate._open_federation_settings = MagicMock()
        gate._visible_element = MagicMock(return_value=MagicMock())
        gate.save_screenshot = MagicMock()
        gate.save_dom = MagicMock()

        gate._assert_visible_context(
            "federation-secondary-owner",
            "fed-1",
            reconcile=False,
            evidence_label="restored",
        )

        evidence_name = (
            "federation-secondary-owner-federation-fed-1-restored"
        )
        gate.save_screenshot.assert_called_once_with(session, evidence_name)
        gate.save_dom.assert_called_once_with(session, evidence_name)

    def test_runtime_reuse_contract_admits_the_declared_restart(self) -> None:
        self.assertEqual(
            RUNTIME_REUSE_CONTRACT.scenario_ids,
            SCENARIO_IDS,
        )
        self.assertTrue(
            RUNTIME_REUSE_CONTRACT.allow_client_replacement,
        )
        self.assertEqual(
            RUNTIME_REUSE_CONTRACT.max_client_launches,
            3,
        )

    def test_station_keyed_manifest_resolves_the_bound_actor(self) -> None:
        runtime = MixedNativeRuntime.__new__(MixedNativeRuntime)
        runtime.manifest = {
            "services": {
                "station-four": {
                    "kind": "station",
                    "runtimeIdentity": "peer-four",
                }
            },
            "clients": [
                {
                    "id": "alice",
                    "actor": "alice",
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": "station-four",
                            "required_kind": "station",
                        }
                    },
                }
            ],
        }
        runtime.client_specs = {
            "alice": dict(runtime.manifest["clients"][0])
        }
        runtime.actor_manifest = {
            "stations": {
                "station-four": {
                    "actors": [
                        {
                            "role": "alice",
                            "accountRef": "station-account:alice@p.t",
                            "ptid": "ptid:alice",
                            "homeStationPeerId": "peer-four",
                        }
                    ]
                }
            }
        }

        self.assertEqual(
            runtime._actor_for_client("alice")["ptid"],
            "ptid:alice",
        )

    def test_projects_only_active_member_station_ids(self) -> None:
        self.assertEqual(
            FederationTwoStationLifecycleGate._active_member_ids(
                {
                    "members": [
                        {
                            "stationPeerId": "station-four",
                            "status": "active",
                        },
                        {
                            "stationPeerId": "station-five-arm",
                            "status": "left",
                        },
                    ]
                }
            ),
            {"station-four"},
        )

    def test_head_tuple_binds_sequence_and_hash(self) -> None:
        self.assertEqual(
            FederationTwoStationLifecycleGate._head_tuple(
                {
                    "headSeq": 7,
                    "headHash": [1] * 32,
                }
            ),
            (7, (1,) * 32),
        )
        with self.assertRaisesRegex(
            GateError,
            "head sequence must be non-negative",
        ):
            FederationTwoStationLifecycleGate._head_tuple(
                {
                    "headSeq": -1,
                    "headHash": [1] * 32,
                }
            )

    def test_requires_the_active_sequencer_endpoint(self) -> None:
        federation = {
            "sequencerStationPeerId": "station-four",
            "members": [
                {
                    "stationPeerId": "station-four",
                    "stationUrl": "https://station-four.test",
                    "status": "active",
                }
            ],
        }
        self.assertEqual(
            FederationTwoStationLifecycleGate._sequencer_endpoint(federation),
            "https://station-four.test",
        )
        federation["members"][0]["status"] = "left"
        with self.assertRaisesRegex(
            GateError,
            "active sequencer Station endpoint is missing",
        ):
            FederationTwoStationLifecycleGate._sequencer_endpoint(federation)

    def test_finds_one_exact_federation_projection(self) -> None:
        snapshot = {
            "federations": [
                {"federationId": "federation-a", "status": "active"},
                {"federationId": "federation-b", "status": "archived"},
            ]
        }
        self.assertEqual(
            FederationTwoStationLifecycleGate._federation(
                snapshot,
                "federation-b",
            )["status"],
            "archived",
        )
        with self.assertRaisesRegex(GateError, "Federation missing is missing"):
            FederationTwoStationLifecycleGate._federation(
                snapshot,
                "missing",
            )


if __name__ == "__main__":
    unittest.main()
