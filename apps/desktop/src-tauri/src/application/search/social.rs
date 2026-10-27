//! Social adapters consume original owner reads, without owning content.

use std::sync::Arc;

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::remote::{RemoteContributor, RemoteSearchReader};
use search_core::{SearchContributor, SearchError, SearchExecutionContext, SourceFuture};
use sha2::{Digest, Sha256};

use crate::application::station_runtime::client::{
    StationClientError, StationClientErrorKind, StationRequestScope,
};
use crate::secure_content::SecureContentSearchBinding;
use crate::state::AppState;

pub const DEVICE_SOURCE: &str = "device.social";
pub const DEVICE_BINDING: &str = "social.device.read";
pub const PUBLIC_SOURCE: &str = "station.social.public";
pub const PUBLIC_BINDING: &str = "social.station.public.read";

pub fn public_read_scope(actor: &str) -> String {
    format!(
        "{PUBLIC_SOURCE}:actor:{}",
        hex::encode(Sha256::digest(actor.as_bytes()))
    )
}

pub fn descriptor(
    source: &str,
    binding: &str,
    authority: &str,
    scope: SearchScope,
) -> SearchContributorDescriptor {
    SearchContributorDescriptor {
        source_id: source.into(),
        owning_module: "social".into(),
        authority_namespaces: vec![authority.into()],
        kinds: vec![
            SearchKind::SocialPost as i32,
            SearchKind::SocialComment as i32,
        ],
        binding_id: binding.into(),
        descriptor_revision: "social-original-owner".into(),
        supports_paging: true,
        max_batch: 100,
        scopes: vec![scope as i32],
    }
}

fn transport_error(error: StationClientError) -> SearchError {
    match error.kind {
        StationClientErrorKind::HttpStatus(404) => SearchError::ResourceUnavailable,
        StationClientErrorKind::HttpStatus(409) => SearchError::SourceChanged,
        StationClientErrorKind::HttpStatus(410) => SearchError::CursorExpired,
        StationClientErrorKind::HttpStatus(408 | 504) => SearchError::Timeout,
        StationClientErrorKind::HttpStatus(400 | 422) => SearchError::InvalidQuery,
        StationClientErrorKind::HttpStatus(401 | 403)
        | StationClientErrorKind::Cancelled
        | StationClientErrorKind::SessionRevoked
        | StationClientErrorKind::StaleRoute => SearchError::Cancelled,
        _ => SearchError::SourceUnavailable("public Social read unavailable".into()),
    }
}

struct PublicReader {
    state: Arc<AppState>,
    scope: StationRequestScope,
    actor: String,
    window: String,
    auth_revision: u64,
}

impl PublicReader {
    fn read<Req: prost::Message, Resp: prost::Message + Default>(
        &self,
        path: &str,
        input: &Req,
        ctx: &SearchExecutionContext,
    ) -> Result<Resp, SearchError> {
        ctx.check()?;
        if ctx.read_scope != public_read_scope(&self.actor)
            || self.state.station.client().active_scope().as_ref() != Some(&self.scope)
        {
            return Err(SearchError::Cancelled);
        }
        let token = {
            let _transition = self
                .state
                .identity_transition
                .lock()
                .map_err(|_| SearchError::Cancelled)?;
            let (session, revision) = self
                .state
                .sessions
                .get_with_revision(&self.window)
                .ok_or(SearchError::Cancelled)?;
            if revision != self.auth_revision || session.actor.ptid != self.actor {
                return Err(SearchError::Cancelled);
            }
            zeroize::Zeroizing::new(session.jwt)
        };
        let response = self
            .state
            .station
            .client()
            .request_bounded_proto_read(
                &self.scope,
                path,
                token.as_str(),
                input,
                ctx.deadline,
                &|| ctx.check().map_err(|error| error.to_string()),
            )
            .map_err(|error| {
                tracing::warn!(
                    path,
                    transport_error_kind = ?error.kind,
                    "public Social Search read failed"
                );
                ctx.check().err().unwrap_or_else(|| transport_error(error))
            })?;
        ctx.check()?;
        Ok(response)
    }
}

impl RemoteSearchReader for PublicReader {
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move { self.read("/api/v1/social/search/query", input, ctx) })
    }
    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            if input.items.iter().any(|item| {
                item.resource
                    .as_ref()
                    .is_none_or(|r| !r.authority_namespace.starts_with("social:public:"))
            }) {
                return Err(SearchError::Protocol);
            }
            self.read("/api/v1/social/search/hydrate", input, ctx)
        })
    }
    fn resolve<'a>(
        &'a self,
        input: &'a ResolveRequest,
        ctx: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        Box::pin(async move {
            if input
                .resource
                .as_ref()
                .is_none_or(|r| !r.authority_namespace.starts_with("social:public:"))
            {
                return Err(SearchError::ResourceUnavailable);
            }
            self.read("/api/v1/social/search/resolve", input, ctx)
        })
    }
}

pub fn public_contributor(
    state: Arc<AppState>,
    scope: StationRequestScope,
    actor: String,
    window: String,
    auth_revision: u64,
) -> Arc<dyn SearchContributor> {
    Arc::new(RemoteContributor::new(
        Arc::new(PublicReader {
            state,
            scope,
            actor,
            window,
            auth_revision,
        }),
        descriptor(
            PUBLIC_SOURCE,
            PUBLIC_BINDING,
            "social:public",
            SearchScope::Station,
        ),
        "social.station.public.open".into(),
    ))
}

pub fn private_contributor(
    reader: SecureContentSearchBinding,
    state: SourceReadState,
    cursors: Arc<AuthenticatedCursorCodec>,
) -> Result<Arc<dyn SearchContributor>, SearchError> {
    super::private::contributor(reader, state, cursors)
}
