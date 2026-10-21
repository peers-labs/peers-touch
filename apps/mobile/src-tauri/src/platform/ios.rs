use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseTargetId {
    Android,
    Ios,
}

impl ReleaseTargetId {
    pub const fn compiled() -> Option<Self> {
        #[cfg(target_os = "android")]
        {
            return Some(Self::Android);
        }

        #[cfg(target_os = "ios")]
        {
            return Some(Self::Ios);
        }

        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        {
            None
        }
    }

    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimePortId {
    Clock,
    Random,
    Network,
    SecureStorage,
    FileStorage,
    KeyMaterial,
    Notifications,
    BackgroundExecution,
    DeepLink,
    Lifecycle,
    Telemetry,
    SystemAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityFactState {
    Available,
    Unavailable,
    Denied,
    Restricted,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityFact {
    pub capability: String,
    pub release_target: ReleaseTargetId,
    pub state: CapabilityFactState,
    pub observed_at: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AdmissionState {
    Available,
    Degraded,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmissionProjection {
    pub capability: String,
    pub state: AdmissionState,
    pub reasons: Vec<String>,
    pub facts: Vec<CapabilityFact>,
    pub station_policy_revision: Option<String>,
    pub runtime_revision: String,
    pub evaluated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SystemAction {
    OpenAppSettings,
    OpenExternalUrl { url: String },
    Share { text: String, url: Option<String> },
    ReturnToSystem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SystemActionState {
    Completed,
    Cancelled,
    Unavailable,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemActionOutcome {
    pub release_target: ReleaseTargetId,
    pub state: SystemActionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub trait PlatformHostPort {
    fn release_target(&self) -> ReleaseTargetId;
}

#[derive(Clone)]
pub struct MobilePlatform {
    release_target: ReleaseTargetId,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileHealth {
    client_form: &'static str,
    release_target: ReleaseTargetId,
    process_model: &'static str,
    shell: &'static str,
    kernel: &'static str,
}

impl MobilePlatform {
    pub fn from_compiled_target() -> Result<Self, &'static str> {
        ReleaseTargetId::compiled()
            .map(Self::for_target)
            .ok_or("Peers Mobile must run on an Android or iOS release target")
    }

    const fn for_target(release_target: ReleaseTargetId) -> Self {
        Self { release_target }
    }

    pub fn health(&self) -> MobileHealth {
        MobileHealth {
            client_form: "mobile",
            release_target: self.release_target,
            process_model: "tauri-mobile",
            shell: "tauri-mobile",
            kernel: "rust-capability-kernel",
        }
    }
}

impl PlatformHostPort for MobilePlatform {
    fn release_target(&self) -> ReleaseTargetId {
        self.release_target
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CapabilityFact, CapabilityFactState, MobileHealth, MobilePlatform, PlatformHostPort,
        ReleaseTargetId, RuntimePortId, SystemAction, SystemActionOutcome, SystemActionState,
    };

    #[test]
    fn release_targets_are_mobile_hosts_not_client_forms() {
        assert_eq!(
            serde_json::to_string(&ReleaseTargetId::Android).unwrap(),
            "\"android\""
        );
        assert_eq!(
            serde_json::to_string(&ReleaseTargetId::Ios).unwrap(),
            "\"ios\""
        );
    }

    #[test]
    fn diagnostics_report_the_selected_release_target() {
        for target in [ReleaseTargetId::Android, ReleaseTargetId::Ios] {
            let platform = MobilePlatform::for_target(target);
            let expected = MobileHealth {
                client_form: "mobile",
                release_target: target,
                process_model: "tauri-mobile",
                shell: "tauri-mobile",
                kernel: "rust-capability-kernel",
            };

            assert_eq!(platform.health(), expected);
            assert_eq!(platform.release_target(), target);
        }
    }

    #[test]
    fn capability_fact_keeps_observation_separate_from_policy() {
        let fact = CapabilityFact {
            capability: "push".to_string(),
            release_target: ReleaseTargetId::Android,
            state: CapabilityFactState::Unknown,
            observed_at: "2026-10-17T00:00:00Z".to_string(),
            source: "native-observer".to_string(),
            detail: Some("provider-not-installed".to_string()),
        };
        let value = serde_json::to_value(fact).unwrap();

        assert_eq!(value["releaseTarget"], "android");
        assert_eq!(value["state"], "unknown");
        assert!(value.get("admitted").is_none());
    }

    #[test]
    fn optional_platform_wire_fields_are_omitted_instead_of_serialized_as_null() {
        let fact = CapabilityFact {
            capability: "push".to_string(),
            release_target: ReleaseTargetId::Ios,
            state: CapabilityFactState::Available,
            observed_at: "2026-10-20T00:00:00Z".to_string(),
            source: "ios.user-notifications".to_string(),
            detail: None,
        };
        let outcome = SystemActionOutcome {
            release_target: ReleaseTargetId::Android,
            state: SystemActionState::Completed,
            reason: None,
        };

        assert!(serde_json::to_value(fact).unwrap().get("detail").is_none());
        assert!(serde_json::to_value(outcome)
            .unwrap()
            .get("reason")
            .is_none());
    }

    #[test]
    fn runtime_ports_and_system_actions_are_closed_typed_contracts() {
        assert_eq!(
            serde_json::to_string(&RuntimePortId::SystemAction).unwrap(),
            "\"system-action\""
        );
        assert_eq!(
            serde_json::to_value(SystemAction::OpenAppSettings).unwrap(),
            serde_json::json!({"kind": "open_app_settings"})
        );
        assert!(serde_json::from_value::<SystemAction>(
            serde_json::json!({"kind": "run_arbitrary_command"})
        )
        .is_err());
        assert_eq!(
            serde_json::to_value(SystemAction::ReturnToSystem).unwrap(),
            serde_json::json!({"kind": "return_to_system"})
        );
    }

    #[test]
    fn diagnostics_never_encode_a_static_ios_shell() {
        let health = MobilePlatform::for_target(ReleaseTargetId::Android).health();
        let json = serde_json::to_string(&health).unwrap();

        assert!(!json.contains(&["ios", "first"].join("-")));
        assert!(!json.contains(&["tauri", "ios"].join("-")));
        assert!(json.contains("\"releaseTarget\":\"android\""));
    }
}
