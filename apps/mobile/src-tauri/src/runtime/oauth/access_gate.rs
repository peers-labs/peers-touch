use serde::{Deserialize, Serialize};

use super::proto::access_gate::v1::{
    access_gate_scalar_value, submit_access_gate_request, AccessGateDeviceTrustInput,
    AccessGateGenericInput, AccessGateScalarValue, AccessGateType, CancelAccessAttemptRequest,
    CancelAccessAttemptResponse, GetAccessDecisionRequest, GetAccessDecisionResponse,
    StartAccessAttemptRequest, StartAccessAttemptResponse, SubmitAccessGateRequest,
    SubmitAccessGateResponse,
};
use super::proto::auth::v1::LoginRequest;
use super::session::{bound_session_id, persist_access_gate_credential};
use super::{
    access_decision_projection, clean_required, load_or_create_identity, oauth_error,
    OAuthAccessDecisionProjection, OAuthCoordinator, ValidatedScope,
};
use crate::error::MobileResult;
use crate::platform::secure_storage::SecureStorage;

const START_RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.StartAccessAttemptResponse";
const SUBMIT_RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.SubmitAccessGateResponse";
const DECISION_RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.GetAccessDecisionResponse";
const CANCEL_RESPONSE_TYPE: &str = "peers_touch.model.access_gate.v1.CancelAccessAttemptResponse";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccessStartInput {
    pub station_origin: String,
    pub station_peer_id: String,
    #[serde(default)]
    pub locale: String,
    #[serde(default)]
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccessDecisionInput {
    pub station_origin: String,
    pub station_peer_id: String,
    pub attempt_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccessSubmitInput {
    pub station_origin: String,
    pub station_peer_id: String,
    pub attempt_id: String,
    pub gate_id: String,
    pub gate_type: i32,
    pub action_id: String,
    pub schema_revision: u32,
    pub schema_digest: String,
    pub submission_id: String,
    pub input: NativeAccessGateInput,
}

#[derive(Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum NativeAccessGateInput {
    Login {
        email: String,
        password: String,
    },
    InviteCode {
        invite_code: String,
    },
    SessionRestore {
        session_id: String,
    },
    DeviceTrust {
        attestation_handle: String,
    },
    Generic {
        fields: Vec<NativeGenericFieldValue>,
    },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGenericFieldValue {
    pub field_name: String,
    pub value: NativeGenericScalar,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum NativeGenericScalar {
    String(String),
    Boolean(bool),
    Integer(i64),
    Number(f64),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAccessProjection {
    pub decision: OAuthAccessDecisionProjection,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub station_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<super::NativeSessionProjection>,
}

impl OAuthCoordinator {
    pub async fn access_start(
        &self,
        storage: &SecureStorage,
        input: NativeAccessStartInput,
    ) -> MobileResult<NativeAccessProjection> {
        let _operation = self.begin_operation()?;
        let scope = ValidatedScope::new(super::OAuthScopeIntent {
            station_origin: input.station_origin.clone(),
            station_peer_id: input.station_peer_id.clone(),
        })?;
        let identity = load_or_create_identity(storage)?;
        let session_id = bound_session_id(storage, &scope)?
            .unwrap_or_else(|| input.session_id.trim().to_string());
        let request = StartAccessAttemptRequest {
            station_url: scope.station_origin.clone(),
            client: Some(super::proto::access_gate::v1::AccessGateClientInfo {
                platform: "mobile".to_string(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                device_id: identity.device_id,
                locale: input.locale,
                lifecycle_generation: identity.generation,
            }),
            session_id,
            station_peer_id: scope.station_peer_id,
        };
        let response: StartAccessAttemptResponse = self
            .transport
            .post_enveloped(
                &scope.station_origin,
                "/actor/access/start",
                &request,
                START_RESPONSE_TYPE,
            )
            .await?;
        let decision = response
            .decision
            .as_ref()
            .ok_or_else(|| oauth_error("accessGateDecisionMissing"))?;
        Ok(NativeAccessProjection {
            decision: access_decision_projection(decision)?,
            station_label: nonempty(response.station_label),
            session: None,
        })
    }

    pub async fn access_decision(
        &self,
        storage: &SecureStorage,
        input: NativeAccessDecisionInput,
    ) -> MobileResult<NativeAccessProjection> {
        let _operation = self.begin_operation()?;
        let scope = ValidatedScope::new(super::OAuthScopeIntent {
            station_origin: input.station_origin.clone(),
            station_peer_id: input.station_peer_id.clone(),
        })?;
        let identity = load_or_create_identity(storage)?;
        let attempt_id = clean_required(input.attempt_id, "accessAttemptId")?;
        let request = GetAccessDecisionRequest {
            attempt_id: attempt_id.clone(),
            station_peer_id: scope.station_peer_id.clone(),
            device_id: identity.device_id.clone(),
            lifecycle_generation: identity.generation,
        };
        let mut response: GetAccessDecisionResponse = self
            .transport
            .post_enveloped(
                &scope.station_origin,
                "/actor/access/decision",
                &request,
                DECISION_RESPONSE_TYPE,
            )
            .await?;
        let session = response
            .login_response
            .take()
            .map(|credential| {
                persist_access_gate_credential(
                    storage,
                    &scope,
                    &identity,
                    &format!("decision-{attempt_id}"),
                    credential,
                )
            })
            .transpose()?;
        let decision = response
            .decision
            .as_ref()
            .ok_or_else(|| oauth_error("accessGateDecisionMissing"))?;
        Ok(NativeAccessProjection {
            decision: access_decision_projection(decision)?,
            station_label: None,
            session,
        })
    }

    pub async fn access_submit(
        &self,
        storage: &SecureStorage,
        input: NativeAccessSubmitInput,
    ) -> MobileResult<NativeAccessProjection> {
        let _operation = self.begin_operation()?;
        let scope = ValidatedScope::new(super::OAuthScopeIntent {
            station_origin: input.station_origin.clone(),
            station_peer_id: input.station_peer_id.clone(),
        })?;
        let identity = load_or_create_identity(storage)?;
        let submission_id = clean_required(input.submission_id.clone(), "submissionId")?;
        let request = validated_submit_request(input, &scope, &identity, &submission_id)?;
        let mut response: SubmitAccessGateResponse = self
            .transport
            .post_enveloped(
                &scope.station_origin,
                "/actor/access/submit",
                &request,
                SUBMIT_RESPONSE_TYPE,
            )
            .await?;
        let session = response
            .login_response
            .take()
            .map(|credential| {
                persist_access_gate_credential(
                    storage,
                    &scope,
                    &identity,
                    &submission_id,
                    credential,
                )
            })
            .transpose()?;
        let decision = response
            .decision
            .as_ref()
            .ok_or_else(|| oauth_error("accessGateDecisionMissing"))?;
        Ok(NativeAccessProjection {
            decision: access_decision_projection(decision)?,
            station_label: None,
            session,
        })
    }

    pub async fn access_cancel(
        &self,
        storage: &SecureStorage,
        input: NativeAccessDecisionInput,
    ) -> MobileResult<bool> {
        let _operation = self.begin_operation()?;
        let scope = ValidatedScope::new(super::OAuthScopeIntent {
            station_origin: input.station_origin,
            station_peer_id: input.station_peer_id,
        })?;
        let identity = load_or_create_identity(storage)?;
        let response: CancelAccessAttemptResponse = self
            .transport
            .post_enveloped(
                &scope.station_origin,
                "/actor/access/cancel",
                &CancelAccessAttemptRequest {
                    attempt_id: clean_required(input.attempt_id, "accessAttemptId")?,
                    station_peer_id: scope.station_peer_id.clone(),
                    device_id: identity.device_id,
                    lifecycle_generation: identity.generation,
                },
                CANCEL_RESPONSE_TYPE,
            )
            .await?;
        Ok(response.cancelled)
    }
}

fn validated_submit_request(
    input: NativeAccessSubmitInput,
    scope: &ValidatedScope,
    identity: &super::PersistedIdentity,
    submission_id: &str,
) -> MobileResult<SubmitAccessGateRequest> {
    let gate_type = AccessGateType::try_from(input.gate_type)
        .map_err(|_| oauth_error("accessGateTypeInvalid"))?;
    let action_id = clean_required(input.action_id, "actionId")?;
    if input.schema_revision == 0
        || input.schema_digest.len() != 64
        || !input
            .schema_digest
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(oauth_error("accessGateSchemaBindingInvalid"));
    }
    let action_input = match (gate_type, input.input) {
        (AccessGateType::AuthLogin, NativeAccessGateInput::Login { email, password }) => Some(
            submit_access_gate_request::ActionInput::Login(LoginRequest {
                email: clean_required(email, "email")?,
                password: clean_required(password, "password")?,
                device_type: "mobile".to_string(),
            }),
        ),
        (AccessGateType::InviteCode, NativeAccessGateInput::InviteCode { invite_code }) => {
            Some(submit_access_gate_request::ActionInput::InviteCode(
                clean_required(invite_code, "inviteCode")?,
            ))
        }
        (
            AccessGateType::AuthSessionRestore,
            NativeAccessGateInput::SessionRestore { session_id },
        ) => Some(submit_access_gate_request::ActionInput::SessionId(
            clean_required(session_id, "sessionId")?,
        )),
        (
            AccessGateType::DeviceTrust,
            NativeAccessGateInput::DeviceTrust { attestation_handle },
        ) => Some(submit_access_gate_request::ActionInput::DeviceTrust(
            AccessGateDeviceTrustInput {
                attestation_handle: clean_required(attestation_handle, "attestationHandle")?,
            },
        )),
        (
            AccessGateType::TermsAcceptance | AccessGateType::Custom,
            NativeAccessGateInput::Generic { fields },
        ) => Some(submit_access_gate_request::ActionInput::Generic(
            AccessGateGenericInput {
                fields: fields
                    .into_iter()
                    .map(generic_field)
                    .collect::<MobileResult<Vec<_>>>()?,
            },
        )),
        _ => return Err(oauth_error("accessGateActionInputMismatch")),
    };
    Ok(SubmitAccessGateRequest {
        attempt_id: clean_required(input.attempt_id, "accessAttemptId")?,
        gate_id: clean_required(input.gate_id, "gateId")?,
        r#type: gate_type as i32,
        action_input,
        action_id,
        station_peer_id: scope.station_peer_id.clone(),
        device_id: identity.device_id.clone(),
        lifecycle_generation: identity.generation,
        schema_revision: input.schema_revision,
        schema_digest: input.schema_digest.to_ascii_lowercase(),
        submission_id: submission_id.to_string(),
    })
}

fn generic_field(input: NativeGenericFieldValue) -> MobileResult<AccessGateScalarValue> {
    let field_name = clean_required(input.field_name, "fieldName")?;
    if field_name.len() > 128 {
        return Err(oauth_error("accessGateFieldNameTooLong"));
    }
    let value = match input.value {
        NativeGenericScalar::String(value) if value.len() <= 4096 => {
            access_gate_scalar_value::Value::StringValue(value)
        }
        NativeGenericScalar::Boolean(value) => access_gate_scalar_value::Value::BoolValue(value),
        NativeGenericScalar::Integer(value) => access_gate_scalar_value::Value::IntegerValue(value),
        NativeGenericScalar::Number(value) if value.is_finite() => {
            access_gate_scalar_value::Value::NumberValue(value)
        }
        _ => return Err(oauth_error("accessGateScalarValueInvalid")),
    };
    Ok(AccessGateScalarValue {
        field_name,
        value: Some(value),
    })
}

fn nonempty(value: String) -> Option<String> {
    let value = value.trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> ValidatedScope {
        ValidatedScope::new(super::super::OAuthScopeIntent {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
        })
        .expect("scope")
    }

    fn identity() -> super::super::PersistedIdentity {
        super::super::PersistedIdentity {
            device_id: "device-a".to_string(),
            generation: 7,
        }
    }

    #[test]
    fn typed_login_is_bound_to_native_identity_and_descriptor() {
        let request = validated_submit_request(
            NativeAccessSubmitInput {
                station_origin: "https://station.example".to_string(),
                station_peer_id: "12D3KooWStation".to_string(),
                attempt_id: "attempt-a".to_string(),
                gate_id: "auth.login".to_string(),
                gate_type: AccessGateType::AuthLogin as i32,
                action_id: "auth.password".to_string(),
                schema_revision: 1,
                schema_digest: "a".repeat(64),
                submission_id: "submission-a".to_string(),
                input: NativeAccessGateInput::Login {
                    email: "alice@example.test".to_string(),
                    password: "secret".to_string(),
                },
            },
            &scope(),
            &identity(),
            "submission-a",
        )
        .expect("request");

        assert_eq!(request.station_peer_id, "12D3KooWStation");
        assert_eq!(request.device_id, "device-a");
        assert_eq!(request.lifecycle_generation, 7);
        assert!(matches!(
            request.action_input,
            Some(submit_access_gate_request::ActionInput::Login(_))
        ));
    }

    #[test]
    fn generic_input_rejects_nested_or_non_finite_values() {
        let input = NativeAccessSubmitInput {
            station_origin: "https://station.example".to_string(),
            station_peer_id: "12D3KooWStation".to_string(),
            attempt_id: "attempt-a".to_string(),
            gate_id: "terms.acceptance".to_string(),
            gate_type: AccessGateType::TermsAcceptance as i32,
            action_id: "terms.accept".to_string(),
            schema_revision: 1,
            schema_digest: "b".repeat(64),
            submission_id: "submission-a".to_string(),
            input: NativeAccessGateInput::Generic {
                fields: vec![NativeGenericFieldValue {
                    field_name: "accepted".to_string(),
                    value: NativeGenericScalar::Number(f64::NAN),
                }],
            },
        };
        assert!(validated_submit_request(input, &scope(), &identity(), "submission-a",).is_err());
    }

    #[test]
    fn tauri_action_input_uses_camel_case_variant_fields() {
        let invite: NativeAccessGateInput = serde_json::from_value(serde_json::json!({
            "kind": "invite_code",
            "inviteCode": "INVITE-ONE"
        }))
        .expect("deserialize invite action");
        assert!(matches!(
            invite,
            NativeAccessGateInput::InviteCode { invite_code }
                if invite_code == "INVITE-ONE"
        ));

        let trust: NativeAccessGateInput = serde_json::from_value(serde_json::json!({
            "kind": "device_trust",
            "attestationHandle": "attestation-1"
        }))
        .expect("deserialize device trust action");
        assert!(matches!(
            trust,
            NativeAccessGateInput::DeviceTrust { attestation_handle }
                if attestation_handle == "attestation-1"
        ));
    }
}
