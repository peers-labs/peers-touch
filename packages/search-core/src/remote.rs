//! Generated read protocol over a pinned, authenticated original remote owner.
//! The host owns transport and credentials. This adapter owns neither.

use std::sync::Arc;

use crate::contributor::{validate_hydration, validate_page, validate_resource};
use crate::model::wire::*;
use crate::{SearchContributor, SearchError, SearchExecutionContext, SourceFuture};

pub trait RemoteSearchReader: Send + Sync {
    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage>;
    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply>;
    fn resolve<'a>(
        &'a self,
        input: &'a ResolveRequest,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource>;
}

pub struct RemoteContributor {
    reader: Arc<dyn RemoteSearchReader>,
    descriptor: SearchContributorDescriptor,
    resolver: String,
}

impl RemoteContributor {
    pub fn new(
        reader: Arc<dyn RemoteSearchReader>,
        descriptor: SearchContributorDescriptor,
        resolver: String,
    ) -> Self {
        Self {
            reader,
            descriptor,
            resolver,
        }
    }
}

impl SearchContributor for RemoteContributor {
    fn supports_suggestions(&self) -> bool {
        false
    }

    fn descriptor(&self) -> &SearchContributorDescriptor {
        &self.descriptor
    }

    fn query<'a>(
        &'a self,
        input: &'a QueryIntent,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, SourcePage> {
        Box::pin(async move {
            context.check()?;
            if input.suggestions {
                return Err(SearchError::OutsideDomain);
            }
            let page = self.reader.query(input, context).await?;
            context.check()?;
            validate_page(&self.descriptor, input, &page)?;
            Ok(page)
        })
    }

    fn hydrate<'a>(
        &'a self,
        input: &'a HydrationRequest,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, HydrationReply> {
        Box::pin(async move {
            context.check()?;
            if input.items.len() > self.descriptor.max_batch as usize {
                return Err(SearchError::Protocol);
            }
            for item in &input.items {
                let resource = item.resource.as_ref().ok_or(SearchError::Protocol)?;
                let kind = validate_resource(resource)?;
                if !self.descriptor.kinds.contains(&(kind as i32)) {
                    return Err(SearchError::Protocol);
                }
            }
            let reply = self.reader.hydrate(input, context).await?;
            context.check()?;
            validate_hydration(input, &reply)?;
            Ok(reply)
        })
    }

    fn resolve<'a>(
        &'a self,
        resource: &'a ResourceRef,
        context: &'a SearchExecutionContext,
    ) -> SourceFuture<'a, ResolvedResource> {
        Box::pin(async move {
            context.check()?;
            validate_resource(resource)?;
            let reply = self
                .reader
                .resolve(
                    &ResolveRequest {
                        resource: Some(resource.clone()),
                        request_id: String::new(),
                        source_id: self.descriptor.source_id.clone(),
                    },
                    context,
                )
                .await?;
            context.check()?;
            if reply
                .resource
                .as_ref()
                .is_none_or(|r| r.fusion_key() != resource.fusion_key())
                || reply.resolver_binding != self.resolver
            {
                return Err(SearchError::Protocol);
            }
            Ok(reply)
        })
    }
}
