//! Native Social Search transport, bound to OAuth and visible OS generation.

use std::io::Read;
use std::sync::Arc;

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::remote::{RemoteContributor, RemoteSearchReader};
use search_core::{SearchContributor, SearchError, SearchExecutionContext, SourceFuture};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};

use crate::platform::lifecycle_bridge::with_visible_generation;
use crate::platform::secure_storage::SecureStorage;
use crate::runtime::oauth::session::current_authenticated_native_session;
use crate::runtime::oauth::OAuthCoordinator;
use crate::social::search::PrivateSocialSearchReader;

mod private;

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

struct PublicReader<R: Runtime> {
    app: AppHandle<R>,
    auth_revision: u64,
    os_generation: u64,
    session_identity: String,
    actor: String,
}

impl<R: Runtime> PublicReader<R> {
    fn read<Req: prost::Message, Resp: prost::Message + Default>(
        &self,
        path: &str,
        input: &Req,
        ctx: &SearchExecutionContext,
    ) -> Result<Resp, SearchError> {
        ctx.check()?;
        if ctx.read_scope != public_read_scope(&self.actor) {
            return Err(SearchError::Cancelled);
        }
        let (origin, token) = self.app.state::<OAuthCoordinator>().with_read_admission(
            Some(self.auth_revision),
            |_| {
                with_visible_generation(Some(self.os_generation), |_| {
                    let session =
                        current_authenticated_native_session(&self.app.state::<SecureStorage>())
                            .map_err(|_| SearchError::Cancelled)?;
                    if super::session_identity(&session) != self.session_identity {
                        return Err(SearchError::Cancelled);
                    }
                    Ok((
                        session.station_origin().to_string(),
                        zeroize::Zeroizing::new(session.access_token().to_string()),
                    ))
                })
            },
        )?;
        let remaining = ctx
            .deadline
            .saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(SearchError::Timeout);
        }
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(remaining)
            .build()
            .map_err(|_| {
                SearchError::SourceUnavailable("public Social transport unavailable".into())
            })?;
        let response = client
            .post(format!("{}{path}", origin.trim_end_matches('/')))
            .bearer_auth(token.as_str())
            .header("Content-Type", "application/protobuf")
            .header("Accept", "application/protobuf")
            .body(input.encode_to_vec())
            .send()
            .map_err(|error| {
                if error.is_timeout() {
                    SearchError::Timeout
                } else {
                    SearchError::SourceUnavailable("public Social read unavailable".into())
                }
            })?;
        ctx.check()?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            log::debug!(target: "search",
                "Search original owner rejected read source=station.social.public operation={path} status={status}");
            return Err(match status {
                400 | 422 => SearchError::InvalidQuery,
                401 | 403 => SearchError::Cancelled,
                404 => SearchError::ResourceUnavailable,
                409 => SearchError::SourceChanged,
                410 => SearchError::CursorExpired,
                408 | 504 => SearchError::Timeout,
                _ => SearchError::SourceUnavailable("public Social owner unavailable".into()),
            });
        }
        if !response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.split(';').next() == Some("application/protobuf"))
        {
            return Err(SearchError::Protocol);
        }
        let mut bytes = Vec::new();
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| SearchError::Protocol)?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(SearchError::Protocol);
        }
        ctx.check()?;
        Resp::decode(bytes.as_slice()).map_err(|_| SearchError::Protocol)
    }
}

impl<R: Runtime> RemoteSearchReader for PublicReader<R> {
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

pub fn public_contributor<R: Runtime>(
    app: AppHandle<R>,
    auth_revision: u64,
    os_generation: u64,
    session_identity: String,
    actor: String,
) -> Arc<dyn SearchContributor> {
    Arc::new(RemoteContributor::new(
        Arc::new(PublicReader {
            app,
            auth_revision,
            os_generation,
            session_identity,
            actor,
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
    reader: Arc<PrivateSocialSearchReader>,
    state: SourceReadState,
    cursors: Arc<AuthenticatedCursorCodec>,
) -> Result<Arc<dyn SearchContributor>, SearchError> {
    private::contributor(reader, state, cursors)
}
