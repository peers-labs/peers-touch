//! Authenticated material reception, enrollment proof and Session commit.
use super::{core, error, protocol, Flow, MobileDeviceLinkRuntime};
use crate::{
    domain::crypto::identity_keys,
    error::MobileResult,
    messaging::lifecycle::import_linked_device_seed,
    platform::secure_storage::SecureStorage,
    runtime::{oauth::link_session, station_route},
};
use device_link_core::{canonical, crypto::ReceiverKey, material, offer, proto::*, transcript};
use ed25519_dalek::{Signer, SigningKey};
use prost::Message;
use zeroize::{Zeroize, Zeroizing};

impl MobileDeviceLinkRuntime {
    pub(super) fn receive_material(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        let response = protocol::material(flow)?;
        let status = response.status.ok_or_else(|| error("invalidResponse"))?;
        self.update(storage, flow, status.clone(), epoch)?;
        if status.selected_claim_id != flow.claim_id {
            return Err(error("claimNotSelected"));
        }
        let offer = flow.offer()?;
        let receiver = ReceiverKey::from_private(flow.receiver_seed);
        let envelope = response
            .identity_material
            .ok_or_else(|| error("identityMaterialMissing"))?;
        let approval: DeviceLinkApprovalTranscript = core(canonical(&envelope.transcript_bytes))?;
        let claim: DeviceLinkClaim = core(canonical(&flow.claim_bytes))?;
        let expected = core(transcript::approval(
            &offer,
            &claim,
            approval.approval_revision,
        ))?;
        if approval != expected {
            return Err(error("transcriptMismatch"));
        }
        // Approval can arrive before the first poll. Otherwise it must retain
        // the same complete comparison context already shown to this phone.
        if !flow.comparison_transcript.is_empty()
            && flow.comparison_transcript != envelope.transcript_bytes
        {
            return Err(error("comparisonChanged"));
        }
        flow.comparison_transcript = envelope.transcript_bytes.clone();
        let existing =
            identity_keys::existing_identity(storage, &flow.actor_scope(), &flow.actor_ptid)?;
        let public = existing.as_ref().map(|i| i.verifying_key.to_bytes());
        let seed = core(material::open_identity(
            &receiver,
            &offer,
            &approval,
            &envelope,
            &response.desktop_transcript_signature,
            public.as_ref().map(|v| v.as_slice()),
            device_link_core::bootstrap::unix_ms(),
        ))?;
        flow.identity_seed = seed.to_vec();
        self.save(storage, flow, epoch)?;
        if status.state == DeviceLinkState::IdentityDelivery as i32
            || status.current_profile_revision > flow.proved_profile
        {
            self.prove(
                storage,
                flow,
                &offer,
                status.current_profile_revision,
                status.revision,
                epoch,
            )?;
            return Ok(());
        }
        if let Some(credential) = response.credential_material {
            let transcript: DeviceLinkCredentialTranscript =
                core(canonical(&credential.transcript_bytes))?;
            if transcript.delivery_id != status.delivery_id
                || device_link_core::digest(&credential.encode_to_vec()).as_slice()
                    != status.credential_digest
            {
                return Err(error("credentialScopeMismatch"));
            }
            let plaintext = core(material::open_credentials(
                &receiver,
                &approval,
                &transcript,
                &credential,
                &response.node_credential_signature,
                &response
                    .node_authorization
                    .ok_or_else(|| error("invalidNodeAuthorization"))?,
                &flow.station_root,
                device_link_core::bootstrap::unix_ms(),
            ))?;
            let mut credential: DeviceLinkCredentialMaterial = core(canonical(&plaintext))?;
            let mut login = credential
                .login
                .take()
                .ok_or_else(|| error("credentialMissing"))?;
            flow.route_transition_candidates = credential
                .connections
                .iter()
                .map(Message::encode_to_vec)
                .collect();
            flow.route_candidates = flow.route_transition_candidates.clone();
            self.save(storage, flow, epoch)?;
            let route = station_route::device_link_reconnect(
                storage,
                &credential.connections,
                &flow.station_peer_id,
                &flow.station_root,
            )?;
            flow.canonical_origin = route.endpoint_origin.clone();
            flow.linked_route = Some(route);
            flow.route_source_ref =
                station_route::device_link_route(&flow.station_peer_id, &flow.station_root)?
                    .source_ref;
            // Persist the admitted route before staging credentials. A failed
            // stage/readback retries on this route after process restart.
            self.save(storage, flow, epoch)?;
            link_session::stage(storage, flow.scope(), &status.delivery_id, &login)?;
            if let Some(tokens) = login.tokens.as_mut() {
                tokens.token.zeroize();
                tokens.access_token.zeroize();
                tokens.refresh_token.zeroize();
            }
            flow.delivery_id = status.delivery_id.clone();
            flow.credential_digest = status.credential_digest.clone();
            flow.session_id = transcript.session_id;
            flow.route_transition_candidates
                .iter_mut()
                .for_each(Zeroize::zeroize);
            flow.route_transition_candidates.clear();
            self.save(storage, flow, epoch)?;
            let mut request = AcknowledgeDeviceLinkRequest {
                authorization: Some(protocol::authorization(flow)),
                delivery_id: flow.delivery_id.clone(),
                credential_digest: flow.credential_digest.clone(),
            };
            let signature = protocol::sign(flow, "ack", &request.encode_to_vec());
            request.authorization.as_mut().unwrap().device_signature = signature;
            let response: AcknowledgeDeviceLinkResponse =
                protocol::post(flow, "ack", "AcknowledgeDeviceLinkResponse", &request)?;
            let status = response.status.ok_or_else(|| error("invalidResponse"))?;
            self.update(storage, flow, status.clone(), epoch)?;
            if status.state != DeviceLinkState::Committed as i32 {
                return Err(error("deliveryPending"));
            }
            self.commit(storage, flow, epoch)?;
        } else if status.state == DeviceLinkState::Committed as i32 {
            self.commit(storage, flow, epoch)?;
        }
        Ok(())
    }

    pub(super) fn prove(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        offer: &offer::VerifiedOffer,
        profile: u64,
        revision: u64,
        epoch: u64,
    ) -> MobileResult<()> {
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            flow.identity_seed
                .as_slice()
                .try_into()
                .map_err(|_| error("identitySeedMissing"))?,
        );
        let mut identity =
            messaging_core::identity::generate_device_identity_for_device_from_parts(
                &flow.actor_ptid,
                &flow.device_id,
                &seed,
                profile,
                Some(&flow.device_seed),
            )
            .map_err(|_| error("enrollmentInvalid"))?;
        identity
            .enrollment
            .certificate
            .device
            .as_mut()
            .ok_or_else(|| error("enrollmentInvalid"))?
            .actor = offer
            .statement
            .actor
            .as_ref()
            .map(|actor| {
                messaging_core::proto::actor::ActorRef::decode(actor.encode_to_vec().as_slice())
                    .map_err(|_| error("enrollmentInvalid"))
            })
            .transpose()?;
        identity.enrollment.actor_cross_signature = SigningKey::from_bytes(&seed)
            .sign(&identity.enrollment.certificate.encode_to_vec())
            .to_bytes();
        let enrollment = messaging_core::proto::actor::EnrollActorDeviceRequest {
            certificate: Some(identity.enrollment.certificate),
            label: "Mobile".to_string(),
            actor_cross_signature: identity.enrollment.actor_cross_signature.to_vec(),
        };
        let enrollment = device_link_core::actor::EnrollActorDeviceRequest::decode(
            enrollment.encode_to_vec().as_slice(),
        )
        .map_err(|_| error("enrollmentInvalid"))?;
        let mut request = ProveDeviceLinkDeviceRequest {
            authorization: Some(protocol::authorization(flow)),
            enrollment: Some(enrollment),
            observed_revision: revision,
        };
        let signature = protocol::sign(flow, "prove", &request.encode_to_vec());
        request.authorization.as_mut().unwrap().device_signature = signature;
        let response: ProveDeviceLinkDeviceResponse =
            protocol::post(flow, "prove", "ProveDeviceLinkDeviceResponse", &request)?;
        flow.proved_profile = profile;
        self.update(
            storage,
            flow,
            response.status.ok_or_else(|| error("invalidResponse"))?,
            epoch,
        )
    }

    pub(super) fn commit(
        &self,
        storage: &SecureStorage,
        flow: &mut Flow,
        epoch: u64,
    ) -> MobileResult<()> {
        self.fence(storage, flow, epoch)?;
        let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
            flow.identity_seed
                .as_slice()
                .try_into()
                .map_err(|_| error("identitySeedMissing"))?,
        );
        identity_keys::import_linked_identity(
            storage,
            &flow.actor_scope(),
            &flow.actor_ptid,
            &seed,
        )?;
        import_linked_device_seed(
            storage,
            &flow.station_peer_id,
            &flow.actor_ptid,
            &flow.device_id,
            &flow.device_seed,
        )?;
        flow.session = Some(link_session::commit(
            storage,
            &flow.station_peer_id,
            &flow.actor_ptid,
            &flow.delivery_id,
            &flow.session_id,
        )?);
        flow.committed = true;
        self.save(storage, flow, epoch)?;
        link_session::discard(storage)?;
        Ok(())
    }
}
