"""Shared declaration for the Desktop Profile and notification proof Suite."""

from tooling.acceptance.core.suite_runtime import RuntimeReuseContract


GATE_ID = "desktop-profile-notifications-e2e"
CAPABILITY_ID = "desktop.profile-notifications-suite"
SCENARIO_IDS = ("desktop-account-profile", "desktop-notification-center")
RUNTIME_REUSE = RuntimeReuseContract(
    entry_check_id="dui-profile-notification-functional",
    scenario_ids=SCENARIO_IDS,
    max_provisioning_runs=1,
    max_client_launches=2,
    min_warm_reuse_rate=0.5,
)
