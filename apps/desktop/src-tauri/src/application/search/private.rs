use std::sync::Arc;

use search_core::cursor::authenticated::AuthenticatedCursorCodec;
use search_core::model::wire::*;
use search_core::projected::{ProjectedContributor, ProjectedPage, ProjectedSearchReader};
use search_core::{ScoredDocument, SearchContributor, SearchError, SearchExecutionContext};

use crate::secure_content::SecureContentSearchBinding;

struct Reader {
    owner: SecureContentSearchBinding,
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
        let metadata = self
            .owner
            .cache_metadata()
            .map_err(SearchError::SourceUnavailable)?;
        let validity = metadata.read_validity.ok_or(SearchError::Protocol)?;
        Ok(SourceReadState {
            source_revision: metadata.source_revision,
            read_scope: validity.read_scope,
            policy_revision: validity.policy_revision,
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
            // This source has no offline read lease. Suggestions cannot contact
            // Station to obtain current authority, so it emits no private body.
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
    owner: SecureContentSearchBinding,
    state: SourceReadState,
    cursors: Arc<AuthenticatedCursorCodec>,
) -> Result<Arc<dyn SearchContributor>, SearchError> {
    let descriptor = super::social::descriptor(
        super::social::DEVICE_SOURCE,
        super::social::DEVICE_BINDING,
        "social",
        SearchScope::Device,
    );
    let revision = state.source_revision.clone();
    Ok(Arc::new(ProjectedContributor::new(
        Arc::new(Reader { owner, state }),
        descriptor,
        revision,
        "social.device.open".into(),
        cursors,
    )?))
}
