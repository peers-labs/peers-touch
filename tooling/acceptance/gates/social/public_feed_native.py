"""Public signed-feed Native consumer; private CSS-09 cannot prove this lane."""

from __future__ import annotations

import hashlib
import json
import secrets
import tempfile
import time
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    EphemeralGateClient, GateError, RuntimeReuseContract, SuiteRuntimeAction, SuiteRuntimeLedger,
    call_async_harness, validate_suite_runtime_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import NativeTwoClientGate
from tooling.acceptance.gates.chat.device_search_runner import DeviceSearchGate
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure, commits_match, read_station_version,
    runtime_station_service, selected_native_runtime, wait_until,
)
from tooling.development.secure_content.runtime_owner import (
    _prepare_cross_station_social_fixture, _prepare_social_suite_federation,
    _prepare_portable_recovery, _restore_portable_recovery,
    _provision_runtime_accounts, _runtime_account_search_query,
)

GATE_ID = "social-public-feed-native-e2e"
SCENARIOS = (
    "publication-late-follower", "non-follower-interaction", "public-edit",
    "restart-readback", "public-search", "public-tombstone",
    "comment-reactions",
    "poll-single-choice", "poll-multiple-choice", "poll-cutoff",
    "normal-submit-readback", "lost-submit-ack", "corrupt-read-payload",
    "rollback-read-head", "second-device-writer-denial",
    "circle-members-pagination", "circle-cancel", "circle-partial-save-retry",
    "lost-federation-notification",
    "circle-block", "circle-account-epoch",
)
RUNTIME_REUSE = RuntimeReuseContract.from_dict({
    "scope": "suite", "entryCheckId": GATE_ID, "scenarioIds": list(SCENARIOS),
    "maxProvisioningRuns": 1, "maxClientLaunches": 4,
    "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": True,
    "requireReceiverVisibleProof": True, "allowClientReplacement": True,
})


@dataclass
class FixtureClient:
    """Bind the existing Social fixture owner to the already-started Driver."""
    session: Any
    station_url: str
    harness_namespace: str = "moments"

    @property
    def driver(self) -> Any:
        return self.session

    @property
    def spec(self) -> Any:
        return self.session

    def harness(self, method: str, payload: dict[str, Any], *, timeout: float) -> Any:
        return call_async_harness(self.session, method, payload,
                                  namespace=self.harness_namespace, script_timeout=timeout)


class Gate(DeviceSearchGate):
    gate_id = GATE_ID
    phase = "Actor-Owned Moments Native"
    bom = ("AFL-08C", "AFL-09")
    spec = ("docs/architecture/domains/social/federation/actor-feed-log.md",)

    def __init__(self) -> None:
        selected = selected_native_runtime(GATE_ID)
        if selected is None:
            raise GateError("Public feed requires a prepared Native runtime")
        # Reuse Native Search's original input and painted-surface oracle;
        # this Suite owns Social fixtures rather than Chat history seeding.
        NativeTwoClientGate.__init__(self,
            manifest=selected.manifest, actor_manifest=selected.actor_manifest,
            runtime_binding=selected.binding, gate_id=GATE_ID,
            journey_id="actor-owned-moments-public",
        )
        if self.manifest.get("environmentId") != "cross-station-social-native":
            raise GateError("Public feed requires the reviewed two-Station environment")
        self.report.runtime["search"] = {}
        self.active_social_scenario: str | None = None
        self.circle_account_queries: list[str] = []
        self.circle_account_switch: dict[str, Any] = {}
        self.circle_remote_member = ""
        self.capability_client = EphemeralGateClient.from_environment()
        if self.capability_client is None:
            raise GateError("Public feed requires its prepared notification capability")

    @property
    def receiver(self) -> Any:
        return self.clients["bob"]

    def action(self, actor: str, method: str, payload: dict[str, Any] | None = None) -> Any:
        return call_async_harness(self.clients[actor], method, payload or {},
                                  namespace="moments", script_timeout=120)

    def prepare_fixture(self, stack: ExitStack) -> dict[str, str]:
        primary = runtime_station_service(self.manifest, "alice")
        secondary = runtime_station_service(self.manifest, "bob")
        federation_id = _prepare_social_suite_federation(
            primary_url=primary["endpoint"], secondary_url=secondary["endpoint"],
            primary_peer_id=primary["runtimeIdentity"], secondary_peer_id=secondary["runtimeIdentity"],
            primary_product_url=primary["endpoint"], fixture_epoch=self.manifest["runId"],
            cleanup_stack=stack)
        for actor in ("alice", "bob"):
            self.action(actor, "reconcileFederationProjection")
        fixture = _prepare_cross_station_social_fixture(
            FixtureClient(self.clients["alice"], primary["endpoint"]),
            FixtureClient(self.clients["bob"], secondary["endpoint"]),
            federation_id=federation_id)
        # Expensive identity provisioning belongs to this preparation lifetime.
        # All candidates subsequently come from the original production search.
        roles = tuple(f"circle-member-{index}" for index in range(22))
        accounts, password = _provision_runtime_accounts(
            primary_station_url=primary["endpoint"],
            run_id=self.manifest["runId"], roles=roles)
        self.circle_account_queries = [
            _runtime_account_search_query(accounts[role], role=role) for role in roles
        ]
        pin = f"{secrets.randbelow(1_000_000):06d}"
        prepared = self.fixture_action("prepareAccountSwitch", {
            "secondaryAccount": accounts[roles[-1]], "password": password, "pin": pin,
        })
        self.circle_account_switch = {**prepared, "pin": pin}
        self.circle_remote_member = fixture["bobPtid"]
        return fixture

    def fixture_action(self, method: str, payload: dict[str, Any]) -> Any:
        return call_async_harness(self.clients["alice"], method, payload,
                                  namespace="secure-content-fixture", script_timeout=120)

    def start_suite_clients(self, ledger: SuiteRuntimeLedger,
                            source_commit: str) -> None:
        recovery_phrase = ""
        try:
            for actor in self.client_specs:
                station = runtime_station_service(self.manifest, actor)
                version = read_station_version(station["endpoint"])
                self.assert_condition(f"{actor}-station-source",
                    commits_match(str(version.get("build_commit") or ""), source_commit),
                    "current source")
                if actor == "bob2":
                    if not recovery_phrase:
                        raise GateError("Second-device recovery was not prepared by Bob")
                    def restore(client: Any) -> None:
                        restored = _restore_portable_recovery(
                            FixtureClient(client, station["endpoint"]), recovery_phrase)
                        self.report.runtime["secondDeviceRecovery"] = restored
                    self.start_client(actor, prepare_authenticated_device=restore)
                    recovery_phrase = ""
                else:
                    self.start_client(actor)
                ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=f"client:{actor}")
                ledger.record(SuiteRuntimeAction.LOGIN, resource_id=f"session:{actor}")
                if actor == "bob" and "bob2" in self.client_specs:
                    recovery_phrase, preparation = _prepare_portable_recovery(
                        FixtureClient(self.clients["bob"], station["endpoint"]))
                    self.report.runtime["secondDeviceRecoveryPreparation"] = preparation
        finally:
            recovery_phrase = ""

    def visible_element(self, actor: str, selector: str) -> Any | None:
        client = self.clients[actor]
        for element in client.find_elements(selector):
            if element.is_displayed() and client.execute_script("""
                const r = arguments[0].getBoundingClientRect();
                const s = getComputedStyle(arguments[0]);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
                  && s.display !== 'none' && Number(s.opacity) > 0;
            """, element):
                return element
        return None

    def click(self, actor: str, selector: str) -> None:
        element = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=120)
        element.click()

    def open_comments(self, actor: str, post_selector: str) -> None:
        selector = f'{post_selector} [data-acceptance-id="social-open-comments"]'
        control = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=30)
        expanded = control.get_attribute("aria-expanded")
        if expanded not in ("true", "false"):
            raise GateError("Moment comment control has no explicit expansion state")
        if expanded == "false":
            control.click()
        def is_open() -> bool:
            current = self.visible_element(actor, selector)
            return current is not None and current.get_attribute("aria-expanded") == "true"
        wait_until(is_open,
                   f"{actor} expanded Moment comments", timeout=30)

    def card(self, actor: str, text: str) -> Any | None:
        return next((element for element in self.clients[actor].find_elements(
            '[data-acceptance-id="social-moment-card"]')
            if element.is_displayed() and text in element.text), None)

    def await_card(self, actor: str, text: str) -> Any:
        def read() -> Any:
            self.action(actor, "findPublicMoment", {"text": text})
            element = self.card(actor, text)
            return element if element and self.visible_element(actor,
                f'[data-acceptance-id="social-moment-card"][data-post-id="{element.get_attribute("data-post-id")}"]') else None
        return wait_until(read, f"{actor} signed public Moment", timeout=120)

    def capture(self, actor: str, label: str) -> None:
        self.save_screenshot(self.clients[actor], label)
        self.save_dom(self.clients[actor], label)

    def await_painted_public_card(self, actor: str, text: str, *, timeout: float = 80) -> Any:
        # Passive oracle: only the original Runtime may initiate repair reads.
        def painted() -> Any:
            card = self.card(actor, text)
            if card is None:
                return None
            observation = self.clients[actor].execute_async_script("""
                const el = arguments[0], done = arguments[arguments.length - 1];
                const visible = () => {
                  if (!el.isConnected) return false;
                  const r = el.getBoundingClientRect(), s = getComputedStyle(el);
                  const left = Math.max(0, r.left), top = Math.max(0, r.top);
                  const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
                  if (right <= left || bottom <= top || s.display === 'none'
                      || s.visibility !== 'visible' || Number(s.opacity) <= 0) return false;
                  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
                  return !!hit && (hit === el || el.contains(hit));
                };
                requestAnimationFrame(() => {
                  const first = visible();
                  requestAnimationFrame(() => done({painted: first && visible(), paintFrames: 2}));
                });
            """, card)
            return card if observation["painted"] and observation["paintFrames"] == 2 else None
        return wait_until(painted, f"{actor} passively painted signed public Moment", timeout=timeout)

    def public_fault(self, actor: str, *, action: str = "read", kind: str = "",
                     target: str = "", label: str = "") -> Any:
        return self.action(actor, "publicFeedFault", {
            "action": action, "kind": kind, "target_actor_ptid": target,
            "id": f"{self.manifest['runId']}:{label}" if label else "",
        })

    def publish_text_ui(self, text: str, actor: str = "alice") -> float:
        self.click(actor, '[data-acceptance-id="social-composer-open"]')
        self.set_input(actor, 'textarea[data-moments-composer-input]', text)
        started = time.monotonic()
        self.click(actor, '[data-acceptance-id="social-composer-publish"]')
        return started

    def circle_projection(self, circle_id: str) -> dict[str, Any] | None:
        projection = self.action("alice", "circleProjection")
        self.assert_condition("circle-observer-actor-bound",
            projection["actorPtidSha256"] == hashlib.sha256(self.ptids["alice"].encode()).hexdigest())
        return next((circle for circle in projection["circles"] if circle["id"] == circle_id), None)

    def assert_circle(self, circle_id: str, name: str, description: str,
                      members: set[str]) -> None:
        selector = f'[data-action-id="circle.manage.{circle_id}"]'
        def settled() -> bool:
            circle = self.circle_projection(circle_id)
            card = self.visible_element("alice", selector)
            return bool(circle and card and circle["membersLoaded"] and not circle["membersError"]
                and circle["name"] == name and circle["description"] == description
                and circle["memberCount"] == len(members)
                and set(circle["memberPtids"]) == members
                and self.clients["alice"].execute_script("""
                    const el = arguments[0], name = arguments[1], description = arguments[2];
                    const r = el.getBoundingClientRect();
                    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                    return !!hit && el.contains(hit)
                      && el.querySelector('.sk-circle-name')?.textContent === name
                      && (el.querySelector('.sk-circle-desc')?.textContent ?? '') === description;
                """, card, name, description))
        wait_until(settled, "Alice painted original complete Circle projection", timeout=60)

    def assert_circle_editor(self, name: str, description: str, members: set[str]) -> None:
        def matches() -> bool:
            return self.clients["alice"].execute_script("""
                const name = document.querySelector('input[data-circle-name]');
                const description = document.querySelector('input[data-circle-desc]');
                const list = document.querySelector('[data-circle-member-count]');
                return name?.value === arguments[0] && description?.value === arguments[1]
                  && Number(list?.dataset.circleMemberCount) === arguments[2].length
                  && JSON.stringify([...list.querySelectorAll('[data-circle-member]')]
                    .map(row => row.dataset.circleMember).sort()) === JSON.stringify(arguments[2]);
            """, name, description, sorted(members))
        wait_until(matches, "Alice complete cancellable Circle editor", timeout=30)
        if members:
            row = self.clients["alice"].find_elements('[data-circle-member]')[-1]
            self.assert_circle_element_painted(row, "circle-last-member-painted")

    def assert_circle_element_painted(self, element: Any, assertion: str) -> None:
        self.clients["alice"].execute_script("arguments[0].scrollIntoView({block:'center'});", element)
        painted = self.clients["alice"].execute_async_script("""
            const el = arguments[0], done = arguments[arguments.length - 1];
            const visible = () => {
              const r = el.getBoundingClientRect(), style = getComputedStyle(el);
              const hit = document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2);
              return el.isConnected && r.width > 0 && r.height > 0 && !!hit && el.contains(hit)
                && style.visibility === 'visible' && Number(style.opacity) > 0;
            };
            requestAnimationFrame(() => {
              const first = visible();
              requestAnimationFrame(() => done(first && visible()));
            });
        """, element)
        self.assert_condition(assertion, painted is True)

    def circle_scenarios(self, ledger: SuiteRuntimeLedger) -> None:
        self.click("alice", '[data-action-id="segment.circles"]')
        name = "Circle-" + hashlib.sha256(self.manifest["runId"].encode()).hexdigest()[:12]
        description = "Native complete membership"
        self.begin_scenario(ledger, "circle-members-pagination")
        self.click("alice", '[data-acceptance-id="social-circle-create-open"]')
        self.set_input("alice", 'input[data-circle-name]', name)
        self.click("alice", '[data-action-id="circle.create"]')
        def created() -> str | None:
            projection = self.action("alice", "circleProjection")
            return next((circle["id"] for circle in projection["circles"]
                         if circle["name"] == name and circle["membersLoaded"]), None)
        circle_id = wait_until(created, "Alice created and hydrated Circle", timeout=60)
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        self.set_input("alice", 'input[data-circle-desc]', description)
        # Include the real remote friend so blocking is exercised against a
        # confirmed Circle member. All identities were prepared before entry.
        self.click("alice", f'[data-action-id="circle.member.add.{circle_id}.{self.circle_remote_member}"]')
        members: set[str] = {self.circle_remote_member}
        for query in self.circle_account_queries[:21]:
            self.set_input("alice", '.sk-circle-candidates input', query)
            def candidate() -> Any | None:
                for row in self.clients["alice"].find_elements('[data-circle-candidate]'):
                    if row.is_displayed() and query in row.text:
                        return row
                return None
            row = wait_until(candidate, "original searched real Circle member", timeout=30)
            ptid = row.get_attribute("data-circle-candidate")
            self.assert_condition("circle-real-member-distinct",
                                  ptid.startswith("ptid:") and ptid not in members)
            self.click("alice", f'[data-action-id="circle.member.add.{circle_id}.{ptid}"]')
            members.add(ptid)
        self.assert_circle_editor(name, description, members)
        self.click("alice", '[data-action-id="circle.save"]')
        self.assert_circle(circle_id, name, description, members)
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        self.assert_circle_editor(name, description, members)
        self.capture("alice", "circle-members-pagination")
        self.complete_scenario(ledger, "circle-members-pagination",
            "alice:real-search-select-and-save-22-local-and-remote-members", "alice:painted-complete-22-member-readback")

        self.begin_scenario(ledger, "circle-cancel")
        removed = sorted(members - {self.circle_remote_member})[0]
        self.set_input("alice", 'input[data-circle-name]', "Cancelled Circle")
        self.set_input("alice", 'input[data-circle-desc]', "Cancelled description")
        self.click("alice", f'[data-action-id="circle.member.remove.{circle_id}.{removed}"]')
        self.click("alice", '[data-action-id="circle.save-cancel"]')
        self.assert_circle(circle_id, name, description, members)
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        self.assert_circle_editor(name, description, members)
        self.capture("alice", "circle-cancel")
        self.complete_scenario(ledger, "circle-cancel",
            "alice:change-name-description-members-and-cancel", "alice:painted-unchanged-22-member-readback")

        self.begin_scenario(ledger, "circle-partial-save-retry")
        # CircleNameMax is 32 runes at the original domain validator. Membership
        # removal commits before the failing rename; the UI must retain the
        # draft while its original Store re-reads that partial committed truth.
        invalid_name = "x" * 33
        remaining = members - {removed}
        self.set_input("alice", 'input[data-circle-name]', invalid_name)
        self.click("alice", f'[data-action-id="circle.member.remove.{circle_id}.{removed}"]')
        self.click("alice", '[data-action-id="circle.save"]')
        warning = wait_until(lambda: self.visible_element("alice",
            '.sk-circle-manage .pt-alert[data-tone="warning"][role="status"]'),
            "original Circle save failure warning", timeout=60)
        self.assert_circle_element_painted(warning, "circle-save-failure-painted")
        self.capture("alice", "circle-partial-save-failure-warning")
        self.assert_circle_editor(invalid_name, description, remaining)
        wait_until(lambda: (circle := self.circle_projection(circle_id)) is not None
                   and circle["name"] == name and set(circle["memberPtids"]) == remaining,
                   "original partial membership commit readback", timeout=60)
        self.capture("alice", "circle-partial-save-failure")
        self.set_input("alice", 'input[data-circle-name]', name)
        self.click("alice", '[data-action-id="circle.save"]')
        self.assert_circle(circle_id, name, description, remaining)
        self.capture("alice", "circle-partial-save-retry")
        self.report.runtime["circleLifecycle"] = {
            "realRegisteredMembers": len(members), "confirmedMembersAfterRetry": len(remaining),
            "cancelRetainedCanonicalMembership": True, "failedRenameRetainedDraft": True,
            "partialCommitReRead": True, "retryConfirmedCanonicalMembership": True,
        }
        self.complete_scenario(ledger, "circle-partial-save-retry",
            "alice:actual-invalid-rename-after-member-removal-and-retry",
            "alice:painted-retained-failure-draft-and-confirmed-retry")
        self.circle_block_scenario(ledger, circle_id, name, description, remaining)
        self.circle_epoch_scenario(ledger, circle_id, name, description, remaining)
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        self.click("alice", f'[data-action-id="circle.delete.{circle_id}"]')
        self.click("alice", '[data-action-id="circle.delete.confirm"]')
        wait_until(lambda: self.circle_projection(circle_id) is None,
                   "original Circle deletion cleanup", timeout=60)
        self.click("alice", '[data-action-id="segment.feed"]')

    def circle_block_scenario(self, ledger: SuiteRuntimeLedger, circle_id: str,
                              name: str, description: str, members: set[str]) -> None:
        self.begin_scenario(ledger, "circle-block")
        self.click("alice", '[data-action-id="segment.feed"]')
        text = f"Circle-block-{self.manifest['runId']}"
        self.publish_text_ui(text, actor="bob")
        bob_card = self.await_card("bob", text)
        alice_card = self.await_card("alice", text)
        alice_id = alice_card.get_attribute("data-post-id")
        self.click("alice", f'[data-post-id="{alice_id}"] .sk-post-author')
        self.click("alice", f'[data-action-id="author.moment.{alice_id}"]')
        # The original detail stays mounted when the Feed hides a blocked
        # author. This is the real product path to the retained unblock control.
        wait_until(lambda: self.visible_element("alice", '[data-action-id="moments.detail.back"]'),
                   "original detail navigation", timeout=30)
        self.click("alice", f'[data-post-id="{alice_id}"] .sk-post-author')
        control = f'[data-action-id="author.block.{self.circle_remote_member}"]'
        self.click("alice", control)
        wait_until(lambda: self.action("alice", "relationshipStatus", {
            "actorPtid": self.circle_remote_member,
        })["blockedByViewer"] is True, "original confirmed block", timeout=60)
        wait_until(lambda: self.action("bob", "relationshipStatus", {
            "actorPtid": self.ptids["alice"],
        })["interactionAllowed"] is False, "counterparty original interaction denied", timeout=60)
        block = wait_until(lambda: self.visible_element("alice", control),
                           "original unblock control", timeout=30)
        self.assert_condition("circle-member-block-control-confirmed",
                              block.get_attribute("data-author-block") == "on")
        self.assert_circle_element_painted(block, "circle-block-control-painted")
        self.capture("alice", "circle-block")
        self.click("alice", control)
        wait_until(lambda: self.action("alice", "relationshipStatus", {
            "actorPtid": self.circle_remote_member,
        })["blockedByViewer"] is False, "original confirmed unblock", timeout=60)
        # Close through the original trigger, then inspect the unchanged
        # publisher-owned list. A block is not a membership deletion command.
        self.click("alice", f'[data-post-id="{alice_id}"] .sk-post-author')
        self.click("alice", '[data-action-id="moments.detail.back"]')
        self.click("alice", '[data-action-id="segment.circles"]')
        self.assert_circle(circle_id, name, description, members)
        self.report.runtime["circleLifecycle"]["blockRetainedMembership"] = True
        self.report.runtime["circleLifecycle"]["counterpartyInteractionDenied"] = True
        self.complete_scenario(ledger, "circle-block", "alice:original-identity-block-and-unblock",
                               "alice,bob:painted-block-control-and-original-counterparty-denial")
        bob_id = bob_card.get_attribute("data-post-id")
        self.click("bob", f'[data-post-id="{bob_id}"] [data-acceptance-id="social-moment-menu"]')
        self.click("bob", f'[data-action-id="moment.delete.{bob_id}"]')
        self.click("bob", '[data-acceptance-id="social-delete-confirm"]')

    def circle_epoch_scenario(self, ledger: SuiteRuntimeLedger, circle_id: str,
                              name: str, description: str, members: set[str]) -> None:
        self.begin_scenario(ledger, "circle-account-epoch")
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        draft = "Uncommitted account draft"
        self.set_input("alice", 'input[data-circle-name]', draft)
        self.assert_circle_editor(draft, description, members)
        before = self.action("alice", "circleProjection")
        prepared = self.circle_account_switch
        secondary = self.fixture_action("switchPreparedAccount", {
            "accountId": prepared["secondaryAccountId"], "actorPtid": prepared["secondaryActorPtid"],
            "storageIdentitySha256": prepared["secondaryStorageIdentitySha256"],
            "outgoingActorPtid": prepared["primaryActorPtid"],
            "outgoingSessionEpoch": before["sessionEpoch"], "pin": prepared["pin"],
        })
        self.click("alice", '[data-pt-primary-nav="moments"] [role="button"]')
        self.click("alice", '[data-action-id="segment.circles"]')
        def isolated() -> bool:
            projection = self.action("alice", "circleProjection")
            return (projection["actorPtidSha256"] == secondary["actorPtidSha256"]
                    and projection["sessionEpoch"] == secondary["afterGeneration"]
                    and not projection["circles"]
                    and self.clients["alice"].execute_async_script("""
                        const circle = arguments[0], draft = arguments[1];
                        const done = arguments[arguments.length - 1];
                        const valid = () => {
                          const empty = [...document.querySelectorAll('.moments-circles .pt-empty')]
                            .find(el => el.getBoundingClientRect().height > 0);
                          if (!empty || document.querySelector('[data-circle-name]')
                              || document.querySelector(`[data-action-id="circle.manage.${circle}"]`)) return false;
                          const r = empty.getBoundingClientRect();
                          const hit = document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
                          return !!hit && empty.contains(hit)
                            && !document.querySelector('.moments-circles')?.textContent.includes(draft);
                        };
                        requestAnimationFrame(() => {
                          const first = valid(); requestAnimationFrame(() => done(first && valid()));
                        });
                    """, circle_id, draft) is True)
        wait_until(isolated, "secondary account painted Circle and draft isolation", timeout=60)
        self.capture("alice", "circle-secondary-account-isolation")
        primary = self.fixture_action("switchPreparedAccount", {
            "accountId": prepared["primaryAccountId"], "actorPtid": prepared["primaryActorPtid"],
            "storageIdentitySha256": prepared["primaryStorageIdentitySha256"],
            "outgoingActorPtid": prepared["secondaryActorPtid"],
            "outgoingSessionEpoch": secondary["afterGeneration"], "pin": prepared["pin"],
        })
        self.assert_condition("circle-account-epoch-advanced",
            primary["afterGeneration"] > secondary["afterGeneration"] > before["sessionEpoch"])
        self.click("alice", '[data-pt-primary-nav="moments"] [role="button"]')
        self.click("alice", '[data-action-id="segment.circles"]')
        self.assert_circle(circle_id, name, description, members)
        self.click("alice", f'[data-action-id="circle.manage.{circle_id}"]')
        self.assert_circle_editor(name, description, members)
        self.click("alice", '[data-action-id="circle.save-cancel"]')
        self.capture("alice", "circle-primary-account-canonical-readback")
        self.report.runtime["circleLifecycle"]["accountEpochIsolated"] = True
        self.report.runtime["circleLifecycle"]["accountSwitchActionClass"] = "prepared-native-fixture-command"
        self.complete_scenario(ledger, "circle-account-epoch",
            "alice:painted-unsaved-circle-edit;original-prepared-native-PIN-switch",
            "alice:painted-secondary-empty-and-primary-canonical-circle-without-old-draft")

    def capture_public_measurement(self, scenario: str, started: float,
                                   observation: dict[str, Any]) -> None:
        self.assert_condition(f"{scenario}-actual-read-observed", observation["readCount"] > 0)
        self.assert_condition(f"{scenario}-bounded-response", observation["boundedResponses"] is True)
        self.assert_condition(f"{scenario}-observation-within-lease", observation["expired"] is False)
        self.report.runtime.setdefault("publicFeedMeasurements", {})[scenario] = {
            "submitToPaintSeconds": round(time.monotonic() - started, 6),
            "receiverNativeReadCount": observation["readCount"],
            "receiverNativeThreadReadCount": observation["threadReadCount"],
            "maxNativeEventPage": observation["maxEventCount"],
            "maxNativeThreadPage": observation["maxThreadCount"],
            "maxNativeResponseBytes": observation["maxResponseBytes"],
            "source": dict(self.manifest["source"]), "receiver": "bob", "sampleCount": 1,
            "claim": "one comparable observed sample; no percentile or improvement claim",
        }

    def baseline_read_scenario(self, ledger: SuiteRuntimeLedger) -> str:
        scenario = "normal-submit-readback"
        self.begin_scenario(ledger, scenario)
        text = f"{scenario}-{self.manifest['runId']}"
        self.public_fault("bob", action="clear")
        self.public_fault("bob", action="arm", kind="observe-reads",
                          target=self.ptids["alice"], label=scenario)
        started = self.publish_text_ui(text)
        self.await_painted_public_card("alice", text)
        self.await_painted_public_card("bob", text)
        self.capture_public_measurement(scenario, started, self.public_fault("bob"))
        self.capture("bob", scenario)
        self.complete_scenario(ledger, scenario, "alice:real-publication",
                               "bob:passive-runtime-painted-authentic-post")
        self.public_fault("bob", action="clear")
        return text

    def lost_ack_scenario(self, ledger: SuiteRuntimeLedger) -> str:
        scenario = "lost-submit-ack"
        self.begin_scenario(ledger, scenario)
        text = f"{scenario}-{self.manifest['runId']}"
        self.public_fault("alice", action="clear")
        self.public_fault("bob", action="clear")
        self.public_fault("bob", action="arm", kind="observe-reads",
                          target=self.ptids["alice"], label=f"{scenario}:receiver")
        self.public_fault("alice", action="arm", kind="drop-submit-ack",
                          target=self.ptids["alice"], label=scenario)
        started = self.publish_text_ui(text)
        self.await_painted_public_card("bob", text)
        self.capture_public_measurement(scenario, started, self.public_fault("bob"))
        observed = self.public_fault("alice")
        self.assert_condition(f"{scenario}-real-ack-loss", observed["effectCount"] == 1)
        self.assert_condition(f"{scenario}-retained-exact-command",
                              bool(observed["commandId"]) and len(observed["eventSha256"]) == 64)
        control = self.visible_element("alice", 'textarea[data-moments-composer-input]')
        self.assert_condition(f"{scenario}-draft-retained",
                              control is not None and control.get_attribute("value") == text)
        self.capture("alice", f"{scenario}-unknown-result")
        self.click("alice", '[data-acceptance-id="social-composer-publish"]')
        self.await_painted_public_card("alice", text)
        self.await_painted_public_card("bob", text)
        settled = self.public_fault("alice")
        self.assert_condition(f"{scenario}-exact-retry", settled["submissionCount"] >= 2
                              and settled["retryBytesMatch"] is True
                              and settled["commandId"] == observed["commandId"])
        self.assert_condition(f"{scenario}-journal-committed",
                              self.action("alice", "publicFeedStatus")["pendingCount"] == 0)
        for actor in ("alice", "bob"):
            cards = self.clients[actor].find_elements('[data-acceptance-id="social-moment-card"]')
            self.assert_condition(f"{scenario}-{actor}-one-painted-post",
                                  sum(card.is_displayed() and text in card.text for card in cards) == 1)
            self.capture(actor, f"{scenario}-{actor}-committed")
        self.complete_scenario(ledger, scenario, "alice:publish-and-same-draft-retry",
                               "bob:one-painted-authentic-post-after-ack-loss")
        self.public_fault("alice", action="clear")
        self.public_fault("bob", action="clear")
        return text

    def notification_control(self, operation: str, payload: dict[str, Any] | None = None) -> Any:
        if self.capability_client is None:
            raise GateError("Social notification capability is unavailable")
        return self.capability_client.invoke(
            "social-feed-notification", operation, payload or {}, timeout_seconds=15,
        )

    def lost_notification_scenario(self, ledger: SuiteRuntimeLedger) -> str:
        scenario = "lost-federation-notification"
        self.begin_scenario(ledger, scenario)
        status = self.action("alice", "publicFeedStatus")
        head = status.get("verifiedSequence")
        self.assert_condition(f"{scenario}-author-verified-head",
            isinstance(head, str) and head.isdecimal() and int(head) < (1 << 64) - 1
            and status["pendingCount"] == 0)
        self.public_fault("bob", action="clear")
        self.public_fault("bob", action="arm", kind="observe-reads",
                          target=self.ptids["alice"], label=scenario)
        deadline = time.monotonic() + 80
        self.notification_control("arm", {
            "actorPtid": self.ptids["alice"], "minimumHead": int(head) + 1,
        })
        try:
            text = f"{scenario}-{self.manifest['runId']}"
            started = self.publish_text_ui(text)
            self.await_painted_public_card("alice", text)

            def repaired() -> Any:
                observed = self.notification_control("read")
                return observed if observed["effectCount"] == 1 and observed["repairApplied"] else None

            remaining = deadline - time.monotonic()
            self.assert_condition(f"{scenario}-repair-budget", remaining > 0)
            observed = wait_until(repaired, "original verified Federation missed-hint repair",
                                  timeout=remaining)
            remaining = deadline - time.monotonic()
            self.assert_condition(f"{scenario}-paint-budget", remaining > 0)
            self.await_painted_public_card("bob", text, timeout=remaining)
            self.assert_condition(f"{scenario}-actual-hint-lost",
                observed["effectCount"] == 1 and len(observed["frameSha256"]) == 64)
            self.assert_condition(f"{scenario}-causal-verified-repair",
                observed["repairReads"] > 0
                and observed["repairAfterSequence"] < observed["observedHead"]
                <= observed["repairVerifiedHead"])
            self.assert_condition(f"{scenario}-bounded-original-repair",
                observed["bounded"] and not observed["expired"])
            self.report.runtime["federationNotification"] = observed
            self.capture_public_measurement(scenario, started, self.public_fault("bob"))
            self.capture("bob", scenario)
            self.complete_scenario(ledger, scenario, "alice:real-publication",
                "bob:painted-authentic-post-after-original-federation-hint-loss")
            return text
        finally:
            cleanup_preserving_primary_failure(
                lambda: self.notification_control("clear"), self.report,
                "Social Federation notification control",
            )
            cleanup_preserving_primary_failure(
                lambda: self.public_fault("bob", action="clear"), self.report,
                "Social receiver read observation",
            )

    def read_integrity_scenario(self, ledger: SuiteRuntimeLedger, *, kind: str,
                                original_text: str) -> str:
        self.begin_scenario(ledger, kind)
        original_id = self.await_painted_public_card("bob", original_text).get_attribute("data-post-id")
        self.public_fault("bob", action="clear")
        self.public_fault("bob", action="arm", kind=kind, target=self.ptids["alice"], label=kind)
        text = f"{kind}-{self.manifest['runId']}"
        started = self.publish_text_ui(text)
        self.await_painted_public_card("alice", text)
        self.await_painted_public_card("bob", text)
        observed = self.public_fault("bob")
        rejection = {"corrupt-read-payload": "FEED_INVALID",
                     "rollback-read-head": "FEED_HEAD_ROLLBACK"}[kind]
        self.assert_condition(f"{kind}-real-response-transformed",
                              observed["effectCount"] == 1 and observed["rejection"] == rejection)
        self.assert_condition(f"{kind}-retained-authentic-body",
                              self.await_painted_public_card("bob", original_text)
                              .get_attribute("data-post-id") == original_id)
        self.capture_public_measurement(kind, started, observed)
        self.capture("bob", f"{kind}-verified-recovery")
        self.complete_scenario(ledger, kind, "alice:real-publication",
                               "bob:painted-authentic-retained-and-recovered-bodies")
        self.public_fault("bob", action="clear")
        return text

    def second_writer_scenario(self, ledger: SuiteRuntimeLedger) -> None:
        scenario = "second-device-writer-denial"
        self.begin_scenario(ledger, scenario)
        self.assert_condition(f"{scenario}-same-actor-separate-device",
                              self.ptids["bob2"] == self.ptids["bob"]
                              and self.device_ids["bob2"] != self.device_ids["bob"])
        text = f"{scenario}-{self.manifest['runId']}"
        self.public_fault("bob2", action="clear")
        self.public_fault("bob2", action="arm", kind="observe-reads",
                          target=self.ptids["bob2"], label=scenario)
        self.publish_text_ui(text, actor="bob2")
        toast = wait_until(lambda: self.visible_element("bob2", '.pt-toast[data-tone="danger"]'),
                           "Bob second-device visible writing-device feedback", timeout=80)
        self.assert_condition(f"{scenario}-writer-feedback-copy", any(copy in toast.text for copy in (
            "请在已授权的写入设备上发布公开内容。当前设备仍可阅读。",
            "Publish public posts from the authorized writing device. This device can still read posts.",
        )))
        painted = self.clients["bob2"].execute_async_script("""
            const el = arguments[0], done = arguments[arguments.length - 1];
            const visible = () => {
              if (!el.isConnected) return false;
              const r = el.getBoundingClientRect(), s = getComputedStyle(el);
              const left = Math.max(0, r.left), top = Math.max(0, r.top);
              const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
              if (right <= left || bottom <= top || s.display === 'none'
                  || s.visibility !== 'visible' || Number(s.opacity) <= 0) return false;
              const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
              return !!hit && (hit === el || el.contains(hit));
            };
            requestAnimationFrame(() => {
              const first = visible();
              requestAnimationFrame(() => done(first && visible()));
            });
        """, toast)
        self.assert_condition(f"{scenario}-painted-error", painted is True)
        self.capture("bob2", scenario)
        error = wait_until(lambda: self.public_fault("bob2").get("submissionRejection"),
                           "Bob second-device typed writer denial", timeout=80)
        self.assert_condition(f"{scenario}-typed-rejection", error == "FEED_WRITER_NOT_AUTHORIZED")
        control = self.visible_element("bob2", 'textarea[data-moments-composer-input]')
        self.assert_condition(f"{scenario}-draft-retained",
                              control is not None and control.get_attribute("value") == text)
        self.assert_condition(f"{scenario}-no-published-card",
                              all(self.card(actor, text) is None for actor in ("alice", "bob", "bob2")))
        self.complete_scenario(ledger, scenario, "bob2:real-publication-attempt",
                               "bob2:painted-writer-denial-and-retained-draft")
        self.click("bob2", '[data-action-id="compose.cancel"]')
        self.public_fault("bob2", action="clear")

    def comment_selector(self, actor: str, post_selector: str, text: str) -> str:
        def locate() -> str | None:
            for row in self.clients[actor].find_elements(
                f"{post_selector} [data-moments-comment]"
            ):
                if row.is_displayed() and self.clients[actor].execute_script("""
                    return arguments[0].querySelector(
                      ':scope > .sk-comment-body > .sk-comment-line > .sk-comment-text'
                    )?.textContent === arguments[1];
                """, row, text):
                    comment_id = row.get_attribute("data-comment-id")
                    return f'{post_selector} [data-comment-id="{comment_id}"]'
            return None
        return wait_until(locate, f"{actor} painted comment", timeout=120)

    def assert_comment_like(self, actor: str, post_selector: str, text: str,
                            count: int, liked: bool) -> str:
        row = self.comment_selector(actor, post_selector, text)
        selector = f"{row} > .sk-comment-body > .sk-comment-meta [data-comment-like]"
        def settled() -> bool:
            control = self.visible_element(actor, selector)
            return bool(control
                and control.get_attribute("data-comment-like-count") == str(count)
                and control.get_attribute("aria-pressed") == str(liked).lower()
                and control.get_attribute("aria-disabled") != "true"
                and control.get_attribute("disabled") is None)
        wait_until(settled, f"{actor} confirmed comment LIKE {count}/{liked}", timeout=120)
        return selector

    def set_input(self, actor: str, selector: str, value: str) -> None:
        control = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=30)
        self.clients[actor].execute_script("""
            const el = arguments[0], value = arguments[1];
            const prototype = el.tagName === 'TEXTAREA'
              ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        """, control, value)
        wait_until(lambda: self.clients[actor].execute_script("""
            const el = arguments[0], expected = arguments[1];
            return el.value === expected || (el.type === 'datetime-local'
              && new Date(el.value).getTime() === new Date(expected).getTime());
        """, control, value),
                   f"{actor} controlled input accepted", timeout=30)

    def create_poll(self, text: str, *, multiple: bool = False, cutoff_seconds: int | None = None) -> dict[str, str]:
        self.click("alice", '[data-acceptance-id="social-composer-open"]')
        self.set_input("alice", 'textarea[data-moments-composer-input]', text)
        self.click("alice", '[data-acceptance-id="social-compose-poll"]')
        invalid = self.visible_element("alice", '[data-acceptance-id="social-composer-publish"]')
        self.assert_condition(f"{text}-empty-poll-publication-disabled", invalid is not None
                              and (invalid.get_attribute("aria-disabled") == "true"
                                   or invalid.get_attribute("disabled") is not None))
        before = self.action("alice", "publicFeedStatus")
        self.click("alice", '[data-acceptance-id="social-composer-publish"]')
        after = self.action("alice", "publicFeedStatus")
        question = self.visible_element("alice", '[data-acceptance-id="social-poll-question"]')
        self.assert_condition(f"{text}-empty-poll-activation-rejected",
            question is not None and question.get_attribute("value") == ""
            and before["pendingCount"] == after["pendingCount"] == 0
            and before["verifiedSequence"] == after["verifiedSequence"])
        self.set_input("alice", '[data-acceptance-id="social-poll-question"]', text + " question")
        for index in range(2):
            self.set_input("alice", f'[data-acceptance-id="social-poll-draft-option-{index}"]', f"Option {index}")
        if multiple:
            self.click("alice", '[data-action-id="compose.poll.add-option"]')
            self.set_input("alice", '[data-acceptance-id="social-poll-draft-option-2"]', "Option 2")
            self.set_input("alice", '[data-acceptance-id="social-poll-maximum"]', "2")
            self.set_input("alice", '[data-acceptance-id="social-poll-minimum"]', "2")
        if cutoff_seconds is not None:
            expiry = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() + cutoff_seconds))
            self.set_input("alice", '.sk-compose-poll input[type="datetime-local"]', expiry)
        # Dismiss/reopen goes through the original draft owner, including poll
        # fields; it must not turn the retained draft back into a text post.
        self.click("alice", '[data-action-id="compose.cancel"]')
        try:
            wait_until(lambda: self.visible_element("alice",
                'textarea[data-moments-composer-input]') is None,
                "Alice composer dismissed", timeout=30)
            self.click("alice", '[data-acceptance-id="social-composer-open"]')
            question = wait_until(lambda: self.visible_element("alice",
                '[data-acceptance-id="social-poll-question"]'),
                "Alice reopened poll question", timeout=30)
            self.assert_condition(f"{text}-poll-draft-restored",
                question.get_attribute("value") == text + " question")
        except Exception:
            cleanup_preserving_primary_failure(
                lambda: self.capture("alice", f"{text}-poll-draft-restore-failure"),
                self.report, "Poll draft restoration diagnostic")
            raise
        self.click("alice", '[data-acceptance-id="social-composer-publish"]')
        return {actor: self.await_card(actor, text).get_attribute("data-post-id") for actor in ("alice", "bob")}

    def poll_selector(self, post_id: str) -> str:
        return f'[data-acceptance-id="social-moment-card"][data-post-id="{post_id}"] [data-acceptance-id="social-poll"]'

    def assert_poll(self, actor: str, text: str, post_id: str, counts: list[int], choices: list[int],
                    *, closed: bool = False) -> None:
        selector = self.poll_selector(post_id)
        def settled() -> bool:
            self.await_card(actor, text)
            element = self.visible_element(actor, selector)
            if element:
                self.clients[actor].execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element)
            return bool(element and self.clients[actor].execute_script("""
                const el = arguments[0], counts = arguments[1], choices = arguments[2], closed = arguments[3];
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                return r.top >= 0 && r.bottom <= innerHeight + 1 && hit && el.contains(hit)
                  && el.dataset.pollState === (closed ? 'closed' : 'ready')
                  && JSON.stringify([...el.querySelectorAll('[data-poll-count]')].map(e => Number(e.dataset.pollCount))) === JSON.stringify(counts)
                  && JSON.stringify([...el.querySelectorAll('input')].flatMap((e, i) => e.checked ? [i] : [])) === JSON.stringify(choices)
                  && Number(el.querySelector('[data-poll-voters]')?.dataset.pollVoters) === (counts.some(n => n > 0) ? 2 : 0)
                  && (!closed || [...el.querySelectorAll('input')].every(e => e.disabled));
            """, element, counts, choices, closed))
        try:
            wait_until(settled, f"{actor} verified poll counts and selection", timeout=120)
        except Exception:
            # Preserve the actual failed predicate before the Suite releases its
            # clients. Counts, selection and paint geometry are independent:
            # a timeout alone cannot identify which original owner failed.
            def observe() -> None:
                element = self.visible_element(actor, selector)
                actual = {"present": False} if element is None else self.clients[actor].execute_script("""
                    const el = arguments[0], r = el.getBoundingClientRect();
                    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                    return {
                      present: true, state: el.dataset.pollState,
                      counts: [...el.querySelectorAll('[data-poll-count]')].map(e => Number(e.dataset.pollCount)),
                      choices: [...el.querySelectorAll('input')].flatMap((e, i) => e.checked ? [i] : []),
                      voters: Number(el.querySelector('[data-poll-voters]')?.dataset.pollVoters),
                      disabled: [...el.querySelectorAll('input')].every(e => e.disabled),
                      top: r.top, bottom: r.bottom, height: r.height, viewportHeight: innerHeight,
                      hitInside: Boolean(hit && el.contains(hit)),
                    };
                """, element)
                self.report.runtime.setdefault("pollFailureObservations", []).append({
                    "actor": actor,
                    "expected": {"counts": counts, "choices": choices, "closed": closed},
                    "actual": actual,
                })
            cleanup_preserving_primary_failure(
                observe, self.report, "Poll verification state diagnostic")
            cleanup_preserving_primary_failure(
                lambda: self.capture(actor, f"{self.active_social_scenario or 'poll'}-{actor}-verification-failure"),
                self.report, "Poll verification Native rendering diagnostic")
            raise

    def select_poll(self, actor: str, post_id: str, indices: list[int]) -> None:
        selector = self.poll_selector(post_id)
        inputs = self.clients[actor].find_elements(f"{selector} input")
        single = inputs[0].get_attribute("type") == "radio"
        for index, control in enumerate(inputs):
            checked = control.get_attribute("checked") in ("true", "checked")
            if (index in indices and not checked) or (not single and index not in indices and checked):
                self.click(actor, f"{selector} [data-poll-option='{index}'] label")

    def poll_scenario(self, ledger: SuiteRuntimeLedger, scenario: str, *, multiple: bool) -> tuple[str, dict[str, str]]:
        self.begin_scenario(ledger, scenario)
        text = f"{scenario}-{self.manifest['runId']}"
        ids = self.create_poll(text, multiple=multiple)
        self.select_poll("bob", ids["bob"], [0, 1] if multiple else [1])
        self.click("bob", f'{self.poll_selector(ids["bob"])} [data-acceptance-id="social-poll-submit"]')
        self.select_poll("alice", ids["alice"], [1, 2] if multiple else [0])
        self.click("alice", f'{self.poll_selector(ids["alice"])} [data-acceptance-id="social-poll-submit"]')
        counts = [1, 2, 1] if multiple else [1, 1]
        self.assert_poll("alice", text, ids["alice"], counts, [1, 2] if multiple else [0])
        self.assert_poll("bob", text, ids["bob"], counts, [0, 1] if multiple else [1])
        self.select_poll("bob", ids["bob"], [1, 2] if multiple else [0])
        self.click("bob", f'{self.poll_selector(ids["bob"])} [data-acceptance-id="social-poll-submit"]')
        counts = [0, 2, 2] if multiple else [2, 0]
        for actor in ("alice", "bob"):
            self.assert_poll(actor, text, ids[actor], counts, [1, 2] if multiple else [0])
        # Local cancellation does not revoke the committed ballot.
        self.select_poll("bob", ids["bob"], [0, 1] if multiple else [1])
        self.click("bob", f'[data-action-id="moment.poll.cancel.{ids["bob"]}"]')
        self.assert_poll("bob", text, ids["bob"], counts, [1, 2] if multiple else [0])
        updated_text = f"Edited-{text}"
        alice_card = f'[data-acceptance-id="social-moment-card"][data-post-id="{ids["alice"]}"]'
        self.click("alice", f'{alice_card} [data-acceptance-id="social-moment-menu"]')
        self.click("alice", f'[data-action-id="moment.edit.{ids["alice"]}"]')
        self.set_input("alice", '[data-acceptance-id="social-edit-input"]', updated_text)
        self.click("alice", '[data-acceptance-id="social-edit-save"]')
        for actor in ("alice", "bob"):
            self.assert_poll(actor, updated_text, ids[actor], counts, [1, 2] if multiple else [0])
        self.capture("bob", scenario)
        self.complete_scenario(ledger, scenario, "alice,bob:poll-publish-vote-replace-cancel",
                               "alice,bob:painted-verified-ballots-and-two-voters")
        return updated_text, ids

    def begin_scenario(self, ledger: SuiteRuntimeLedger, scenario: str) -> None:
        ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario)
        self.active_social_scenario = scenario

    def complete_scenario(self, ledger: SuiteRuntimeLedger, scenario: str, action: str, receiver: str) -> None:
        ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario, resource_id=action)
        ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=scenario, resource_id=receiver)
        ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario)
        self.active_social_scenario = None

    def run(self) -> dict[str, Any]:
        source = self.manifest["source"]
        ledger = SuiteRuntimeLedger(RUNTIME_REUSE,
            suite_runtime_id=self.manifest["runId"],
            source_digest=(source["commit"]
                if source.get("workspaceDigest") in (None, "", "clean")
                else source["workspaceDigest"].removeprefix("sha256:")),
            fixture_epoch=self.actor_manifest["runId"])
        ledger.record(SuiteRuntimeAction.PROVISION, resource_id="two-station-runtime")
        ledger.record(SuiteRuntimeAction.ACCOUNT_PROVISION, resource_id="alice,bob")
        cleanup: dict[str, Any] = {}
        source_identity: dict[str, Any] = {}
        self.report.runtime["resourcePlanDeviation"] = {
            "plannedMaxClientLaunches": 3, "requiredMaxClientLaunches": 4,
            "reason": "three isolated devices plus original Bob restart",
            "plannedOutcomeSectionUnchanged": True,
        }
        text = f"AFL-{self.manifest['runId']}"
        edited_text = f"Updated-{self.manifest['runId']}"
        try:
            self.verify_fixture_ready()
            self.start_suite_clients(ledger, source["commit"])
            primary = runtime_station_service(self.manifest, "alice")
            secondary = runtime_station_service(self.manifest, "bob")
            self.assert_condition("two-distinct-stations",
                primary["runtimeIdentity"] != secondary["runtimeIdentity"])
            source_identity = self.source_identity(read_station_version(primary["endpoint"]))
            with ExitStack() as stack:
                fixture = self.prepare_fixture(stack)
                ledger.record(SuiteRuntimeAction.ACCOUNT_PROVISION, resource_id="22-real-circle-members")
                self.action("bob", "unfollowActor", {"actorPtid": fixture["alicePtid"]})
                for actor in self.client_specs:
                    self.click(actor, '[data-pt-primary-nav="moments"] [role="button"]')
                    self.click(actor, '[data-action-id="segment.feed"]')

                self.begin_scenario(ledger, SCENARIOS[0])
                self.click("alice", '[data-acceptance-id="social-composer-open"]')
                wait_until(lambda: self.visible_element("alice", 'textarea[data-moments-composer-input]'),
                           "Alice composer input", timeout=30).send_keys(text)
                self.click("alice", '[data-acceptance-id="social-composer-publish"]')
                alice_card = self.await_card("alice", text)
                self.action("bob", "followActor", {"actorPtid": fixture["alicePtid"]})
                bob_card = self.await_card("bob", text)
                alice_id = alice_card.get_attribute("data-post-id")
                bob_id = bob_card.get_attribute("data-post-id")
                self.assert_condition("native-public-commit", self.action("alice", "publicFeedStatus")["pendingCount"] == 0)
                self.capture("bob", SCENARIOS[0])
                self.complete_scenario(ledger, SCENARIOS[0], "alice:composer-publish", "bob:painted-signed-body")

                self.begin_scenario(ledger, SCENARIOS[1])
                self.action("bob", "unfollowActor", {"actorPtid": fixture["alicePtid"]})
                bob_selector = f'[data-post-id="{bob_id}"]'
                self.open_comments("bob", bob_selector)
                comment_text = f"Non-follower {text}"
                comment_input = wait_until(lambda: self.visible_element("bob",
                    f'{bob_selector} [data-acceptance-id="social-comment-input"]'), "Bob comment input", timeout=30)
                comment_input.send_keys(comment_text)
                self.click("bob", f'{bob_selector} [data-acceptance-id="social-comment-send"]')
                wait_until(lambda: comment_text in self.await_card("bob", text).text, "Bob committed comment", timeout=120)
                self.click("bob", f'{bob_selector} [data-acceptance-id="social-reaction-trigger"]')
                self.click("bob", '[data-acceptance-id="social-reaction-pick-1"]')
                alice_selector = f'[data-post-id="{alice_id}"]'
                self.open_comments("alice", alice_selector)
                wait_until(lambda: comment_text in self.await_card("alice", text).text, "Alice non-follower comment", timeout=120)
                wait_until(lambda: self.visible_element("alice",
                    f'{alice_selector} [data-acceptance-id="social-reaction-chip-1"]'), "Alice signed reaction", timeout=120)
                self.capture("alice", SCENARIOS[1])
                self.complete_scenario(ledger, SCENARIOS[1], "bob:comment-send-and-reaction-pick", "alice:painted-thread-and-reaction")

                self.begin_scenario(ledger, SCENARIOS[6])
                alice_root = self.assert_comment_like("alice", alice_selector, comment_text, 0, False)
                self.click("alice", alice_root)
                bob_root = self.assert_comment_like("bob", bob_selector, comment_text, 1, False)
                self.assert_comment_like("alice", alice_selector, comment_text, 1, True)
                self.click("bob", bob_root)
                self.assert_comment_like("alice", alice_selector, comment_text, 2, True)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                self.click("alice", alice_root)
                self.assert_comment_like("alice", alice_selector, comment_text, 1, False)
                self.assert_comment_like("bob", bob_selector, comment_text, 1, True)
                self.click("alice", alice_root)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                root_row = self.comment_selector("alice", alice_selector, comment_text)
                self.click("alice", f"{root_row} > .sk-comment-body > .sk-comment-meta [data-moments-comment-reply]")
                reply_text = f"Reply {text}"
                reply_input = wait_until(lambda: self.visible_element("alice",
                    f'{alice_selector} [data-acceptance-id="social-comment-input"]'),
                    "Alice reply input", timeout=30)
                reply_input.send_keys(reply_text)
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-comment-send"]')
                bob_reply = self.assert_comment_like("bob", bob_selector, reply_text, 0, False)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 1, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 0, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 0, False)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 1, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                for actor in ("alice", "bob"):
                    self.capture(actor, f"{SCENARIOS[6]}-{actor}")
                self.complete_scenario(ledger, SCENARIOS[6],
                    "alice,bob:root-and-reply-like-set-remove", "alice,bob:painted-confirmed-counts")

                polls = [
                    self.poll_scenario(ledger, SCENARIOS[7], multiple=False),
                    self.poll_scenario(ledger, SCENARIOS[8], multiple=True),
                ]
                self.begin_scenario(ledger, SCENARIOS[9])
                cutoff_text = f"Cutoff-{self.manifest['runId']}"
                cutoff_ids = self.create_poll(cutoff_text, cutoff_seconds=30)
                for actor in ("alice", "bob"):
                    self.assert_poll(actor, cutoff_text, cutoff_ids[actor], [0, 0], [], closed=True)
                self.capture("bob", SCENARIOS[9])
                self.complete_scenario(ledger, SCENARIOS[9], "alice:publish-short-deadline",
                                       "bob:painted-closed-poll-and-disabled-options")

                self.begin_scenario(ledger, SCENARIOS[2])
                self.action("bob", "followActor", {"actorPtid": fixture["alicePtid"]})
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-moment-menu"]')
                self.click("alice", f'[data-action-id="moment.edit.{alice_id}"]')
                editor = wait_until(lambda: self.visible_element("alice",
                    '[data-acceptance-id="social-edit-input"]'), "Alice signed edit input", timeout=30)
                editor.clear()
                editor.send_keys(edited_text)
                self.click("alice", '[data-acceptance-id="social-edit-save"]')
                self.assert_condition("author-edit-object-id",
                    self.await_card("alice", edited_text).get_attribute("data-post-id") == alice_id)
                self.assert_condition("receiver-edit-object-id",
                    self.await_card("bob", edited_text).get_attribute("data-post-id") == bob_id)
                self.capture("bob", SCENARIOS[2])
                self.complete_scenario(ledger, SCENARIOS[2], "alice:edit-save", "bob:painted-updated-signed-body")

                self.begin_scenario(ledger, SCENARIOS[3])
                self.restart_client("bob")
                ledger.record(SuiteRuntimeAction.CLIENT_REPLACEMENT, resource_id="client:bob", scenario_id=SCENARIOS[3])
                self.click("bob", '[data-pt-primary-nav="moments"] [role="button"]')
                self.click("bob", '[data-action-id="segment.feed"]')
                self.await_card("bob", edited_text)
                self.open_comments("bob", bob_selector)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                for index, (poll_text, poll_ids) in enumerate(polls):
                    self.assert_poll("bob", poll_text, poll_ids["bob"],
                                     [2, 0] if index == 0 else [0, 2, 2], [0] if index == 0 else [1, 2])
                self.capture("bob", SCENARIOS[3])
                self.complete_scenario(ledger, SCENARIOS[3], "bob:native-restart", "bob:painted-replayed-updated-body")

                self.action("bob", "followActor", {"actorPtid": fixture["alicePtid"]})
                self.baseline_read_scenario(ledger)
                self.lost_notification_scenario(ledger)
                recent_text = self.lost_ack_scenario(ledger)
                recent_text = self.read_integrity_scenario(
                    ledger, kind="corrupt-read-payload", original_text=recent_text)
                self.read_integrity_scenario(
                    ledger, kind="rollback-read-head", original_text=recent_text)
                self.second_writer_scenario(ledger)

                self.begin_scenario(ledger, SCENARIOS[4])
                self.open_search()
                self.click("bob", '[data-search-filter="social"]')
                self.fill(edited_text)
                result_selector = (
                    f'.pt-search-row[data-resource-id="{bob_id}"]'
                    '[data-source-id="station.social.public"]'
                )
                wait_until(lambda: self.visible_element("bob", result_selector),
                           "Bob Search issued replicated public post", timeout=120)
                page = self.native_page(edited_text)
                item = next((item for item in page["items"]
                             if item["resource"]["id"] == bob_id
                             and item["sourceId"] == "station.social.public"), None)
                self.assert_condition("search-replicated-public-identity", item is not None)
                self.assert_condition("search-replicated-updated-body",
                    edited_text in self.rows() and self.wait_surface()["painted"])
                self.report.runtime["search"]["replicatedPublicReference"] = item
                self.capture("bob", SCENARIOS[4])
                self.complete_scenario(ledger, SCENARIOS[4],
                    "bob:search-social-query", "bob:painted-replicated-updated-result")

                self.begin_scenario(ledger, SCENARIOS[5])
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-moment-menu"]')
                self.click("alice", f'[data-action-id="moment.delete.{alice_id}"]')
                self.click("alice", '[data-acceptance-id="social-delete-confirm"]')
                for actor in ("alice", "bob"):
                    def removed(actor: str = actor) -> bool:
                        result = self.action(actor, "findPublicMoment", {"text": edited_text})
                        return result.get("found") is False and self.card(actor, edited_text) is None
                    wait_until(removed, f"{actor} tombstoned card removed", timeout=120)
                self.assert_condition("native-tombstone-committed",
                    self.action("alice", "publicFeedStatus")["pendingCount"] == 0)
                self.wait_js(
                    f"!document.querySelector({json.dumps(result_selector)})"
                    " && !!document.querySelector('.pt-search-empty')"
                    " && !document.querySelector('.pt-search-error')"
                    " && document.querySelector('.pt-search-body')?.getAttribute('aria-busy') === 'false'"
                    f" && document.querySelector('.pt-search-body')?.dataset.displayedQuery === {json.dumps(edited_text)}",
                    "Bob public tombstone removes the actual retained Search result", timeout=120)
                self.assert_condition("search-tombstone-painted-empty", self.wait_surface()["painted"])
                self.capture("bob", SCENARIOS[5])
                self.complete_scenario(ledger, SCENARIOS[5],
                    "alice:delete-confirm", "bob:no-painted-deleted-card-or-search-result")
                self.circle_scenarios(ledger)
        finally:
            def release() -> None:
                nonlocal cleanup
                cleanup = self.cleanup_clients()
                self.report.runtime["cleanup"] = cleanup
                capability = getattr(self, "capability_client", None)
                if capability is not None:
                    capability.close()
                    self.capability_client = None
                    cleanup["notificationChannelClosed"] = True
                if cleanup.get("cleanupErrors"):
                    raise GateError("Public Native Suite cleanup failed")
                if self.active_social_scenario is not None:
                    # End the failed scenario's lifetime without supplying a
                    # successful UI action or receiver assertion. The ledger
                    # remains invalid; actual cleanup is recorded separately.
                    ledger.record(SuiteRuntimeAction.SCENARIO_END,
                                  scenario_id=self.active_social_scenario)
                    self.active_social_scenario = None
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE, resource_id="suite")
                self.report.runtime["suiteRuntimeReport"] = ledger.report()
            cleanup_preserving_primary_failure(release, self.report, "Public signed-feed Native")
        runtime_report = ledger.report()
        validate_suite_runtime_report(runtime_report, RUNTIME_REUSE)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as artifact:
            json.dump(runtime_report, artifact, sort_keys=True)
            artifact_path = Path(artifact.name)
        try:
            self.report.add_evidence_file("suite-runtime", artifact_path, destination_dir=self.evidence_dir)
        finally:
            artifact_path.unlink(missing_ok=True)
        self.assert_condition("public-native-scenarios", True)
        return {"evidenceClass": "ACCEPTANCE_PROOF", "sourceIdentity": source_identity,
            "scenarioResults": {scenario: "PASS" for scenario in SCENARIOS},
            "textSha256": hashlib.sha256(text.encode()).hexdigest(),
            "suiteRuntimeReport": runtime_report, "cleanup": cleanup,
            "unprovenScope": ["Prototype visual parity", "Mobile Native"]}


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
