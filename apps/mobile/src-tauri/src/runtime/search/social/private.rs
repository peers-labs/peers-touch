use std::sync::Arc;

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::projected::{ProjectedContributor, ProjectedPage, ProjectedSearchReader};
use search_core::{ScoredDocument, SearchContributor, SearchError, SearchExecutionContext};

use crate::social::search::PrivateSocialSearchReader;

struct Reader {
    owner: Arc<PrivateSocialSearchReader>,
    state: SourceReadState,
}

impl ProjectedSearchReader for Reader {
    fn supports_suggestions(&self) -> bool {
        false
    }

    fn revision(&self) -> Result<String, SearchError> {
        self.owner
            .search_revision()
            .map_err(SearchError::SourceUnavailable)
    }
    fn read_state(&self) -> Result<SourceReadState, SearchError> {
        let revision = self.revision()?;
        Ok(SourceReadState {
            source_revision: revision.clone(),
            policy_revision: revision,
            no_store: true,
            ..self.state.clone()
        })
    }
    fn query_documents(
        &self,
        input: &QueryIntent,
        ctx: &SearchExecutionContext,
        before: Option<(i64, &str, &str)>,
        limit: usize,
    ) -> Result<ProjectedPage, SearchError> {
        if input.suggestions {
            return Ok(ProjectedPage {
                documents: Vec::new(),
                next_before: None,
            });
        }
        if !input.conversation_id.is_empty() || input.attachment_names_only {
            return Err(SearchError::InvalidQuery);
        }
        let kinds = input
            .kinds
            .iter()
            .map(|kind| SearchKind::try_from(*kind).map_err(|_| SearchError::InvalidQuery))
            .collect::<Result<Vec<_>, _>>()?;
        let page = self
            .owner
            .search_documents_page(&input.text, &kinds, before, limit, ctx.deadline, &|| {
                ctx.check().map_err(|e| e.to_string())
            })
            .map_err(SearchError::SourceUnavailable)?;
        Ok(ProjectedPage {
            documents: page.documents,
            next_before: page.next_before,
        })
    }
    fn read_resources(
        &self,
        refs: &[ResourceRef],
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<ScoredDocument>, SearchError> {
        self.owner
            .search_read_resources(refs, ctx.deadline, &|| {
                ctx.check().map_err(|e| e.to_string())
            })
            .map_err(SearchError::SourceUnavailable)
    }
}

pub fn contributor(
    owner: Arc<PrivateSocialSearchReader>,
    state: SourceReadState,
    cursors: Arc<AuthenticatedCursorCodec>,
) -> Result<Arc<dyn SearchContributor>, SearchError> {
    let mut descriptor = super::descriptor(
        super::DEVICE_SOURCE,
        super::DEVICE_BINDING,
        "social",
        SearchScope::Device,
    );
    descriptor.authority_namespaces = owner
        .search_authorities()
        .map_err(SearchError::SourceUnavailable)?;
    if descriptor.authority_namespaces.is_empty() {
        descriptor.authority_namespaces.push("social".into());
    }
    let revision = state.source_revision.clone();
    Ok(Arc::new(ProjectedContributor::new(
        Arc::new(Reader { owner, state }),
        descriptor,
        revision,
        "social.device.open".into(),
        cursors,
    )?))
}
