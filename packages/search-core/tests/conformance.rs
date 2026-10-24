use search_core::contributor::{
    namespace_allowed, narrow_intent, normalize_intent, validate_hydration, validate_page,
    validate_resource,
};
use search_core::model::wire::*;
use search_core::SearchError;

fn post() -> ResourceRef {
    ResourceRef {
        kind: "social-post".into(),
        id: "post".into(),
        authority_namespace: "station".into(),
        content_revision: "one".into(),
        ..Default::default()
    }
}
fn comment() -> ResourceRef {
    ResourceRef {
        kind: "social-comment".into(),
        id: "comment".into(),
        authority_namespace: "station".into(),
        content_revision: "one".into(),
        parent: Some(Box::new(post())),
        anchor: Some(ResourceAnchor {
            kind: "comment".into(),
            id: "comment".into(),
        }),
        ..Default::default()
    }
}
fn descriptor() -> SearchContributorDescriptor {
    SearchContributorDescriptor {
        source_id: "source".into(),
        owning_module: "owner".into(),
        authority_namespaces: vec!["station".into()],
        kinds: vec![
            SearchKind::SocialPost as i32,
            SearchKind::SocialComment as i32,
        ],
        binding_id: "binding".into(),
        descriptor_revision: "one".into(),
        supports_paging: true,
        max_batch: 100,
        scopes: vec![SearchScope::Station as i32],
    }
}
fn intent() -> QueryIntent {
    QueryIntent {
        text: "query".into(),
        kinds: vec![SearchKind::SocialComment as i32],
        scopes: vec![SearchScope::Station as i32],
        limit: 20,
        ..Default::default()
    }
}
fn metadata() -> CacheMetadata {
    CacheMetadata {
        source_revision: "one".into(),
        validator: "one".into(),
        read_validity: Some(ReadValidity {
            read_scope: "actor".into(),
            policy_revision: "one".into(),
            owner_check_required: true,
            ..Default::default()
        }),
        ..Default::default()
    }
}
fn page(resource: ResourceRef) -> SourcePage {
    SourcePage {
        candidates: vec![SourceCandidate {
            resource: Some(resource),
            source_rank: 1.0,
        }],
        coverage: Some(SourceCoverage {
            source_id: "source".into(),
            state: SourceState::Ready as i32,
            extent: CoverageExtent::DeclaredScope as i32,
            ..Default::default()
        }),
        cache: Some(metadata()),
        ..Default::default()
    }
}

#[test]
fn comment_identity_is_independent_and_requires_canonical_typed_parent() {
    let valid = comment();
    assert_eq!(validate_resource(&valid), Ok(SearchKind::SocialComment));
    assert_ne!(valid.fusion_key(), post().fusion_key());
    let mut same_id = valid.clone();
    same_id.id = "post".into();
    assert_ne!(same_id.fusion_key(), post().fusion_key());
    let mut invalid = valid.clone();
    invalid.parent = None;
    assert_eq!(validate_resource(&invalid), Err(SearchError::Protocol));
    let mut invalid = valid.clone();
    invalid.parent.as_mut().unwrap().authority_namespace = "other".into();
    assert!(validate_resource(&invalid).is_err());
    let mut invalid = valid.clone();
    invalid.parent.as_mut().unwrap().parent = Some(Box::new(post()));
    assert!(validate_resource(&invalid).is_err());
    let mut invalid = valid;
    invalid.anchor.as_mut().unwrap().id = "post".into();
    assert!(validate_resource(&invalid).is_err());
}

#[test]
fn generated_kind_scope_and_content_filters_are_enforced() {
    let d = descriptor();
    let input = intent();
    assert!(validate_page(&d, &input, &page(comment())).is_ok());
    assert!(validate_page(&d, &input, &page(post())).is_err());
    let mut input = input.clone();
    input.scopes = vec![SearchScope::Device as i32];
    assert!(validate_page(&d, &input, &page(comment())).is_err());
    let mut input = intent();
    input.conversation_id = "conversation".into();
    assert!(narrow_intent(&d, &input).is_none());
    assert!(validate_page(&d, &input, &page(comment())).is_err());
    let mut input = intent();
    input.attachment_names_only = true;
    assert!(narrow_intent(&d, &input).is_none());
    assert!(validate_page(&d, &input, &page(comment())).is_err());
    assert!(normalize_intent(QueryIntent {
        suggestions: true,
        ..intent()
    })
    .is_err());
    assert!(normalize_intent(QueryIntent {
        scopes: vec![SearchScope::Federation as i32],
        ..intent()
    })
    .is_err());
    assert!(normalize_intent(QueryIntent {
        text: "...".into(),
        ..intent()
    })
    .is_err());
}

#[test]
fn hydration_cannot_replace_parent_anchor_kind_or_content_revision() {
    let request = HydrationRequest {
        items: vec![HydrationItem {
            item_id: "one".into(),
            resource: Some(comment()),
            fields: vec![ProjectionField::Result as i32],
            known_validator: String::new(),
        }],
        refresh: false,
    };
    let valid = HydrationReply {
        outcomes: vec![HydrationOutcome {
            item_id: "one".into(),
            outcome: Some(hydration_outcome::Outcome::Changed(AuthorizedProjection {
                result: Some(ResultItem {
                    resource: Some(comment()),
                    kind: SearchKind::SocialComment as i32,
                    ..Default::default()
                }),
                fields: vec![ProjectionField::Result as i32],
                cache: Some(metadata()),
            })),
        }],
    };
    assert!(validate_hydration(&request, &valid).is_ok());
    for mutation in 0..4 {
        let mut reply = valid.clone();
        let Some(hydration_outcome::Outcome::Changed(p)) = reply.outcomes[0].outcome.as_mut()
        else {
            unreachable!()
        };
        let result = p.result.as_mut().unwrap();
        let resource = result.resource.as_mut().unwrap();
        match mutation {
            0 => resource.parent.as_mut().unwrap().id = "other".into(),
            1 => resource.anchor.as_mut().unwrap().id = "other".into(),
            2 => result.kind = SearchKind::SocialPost as i32,
            _ => resource.content_revision = "other".into(),
        }
        assert!(validate_hydration(&request, &reply).is_err());
    }
    let mut omitted = valid;
    omitted.outcomes.clear();
    assert!(validate_hydration(&request, &omitted).is_err());
}

#[test]
fn attachment_and_message_parent_anchor_do_not_share_identity() {
    let attachment = ResourceRef {
        kind: "attachment".into(),
        id: "attachment".into(),
        conversation_id: "conversation".into(),
        message_id: "message".into(),
        authority_namespace: "station".into(),
        ..Default::default()
    };
    let message = ResourceRef {
        kind: "message".into(),
        id: "message".into(),
        conversation_id: "conversation".into(),
        message_id: "message".into(),
        authority_namespace: "station".into(),
        ..Default::default()
    };
    assert_ne!(attachment.fusion_key(), message.fusion_key());
}

#[test]
fn trusted_namespace_roots_admit_only_exact_or_colon_delimited_descendants() {
    let mut d = descriptor();
    d.authority_namespaces = vec!["authority:public".into()];
    assert!(namespace_allowed(&d, "authority:public"));
    assert!(namespace_allowed(&d, "authority:public:original-domain"));
    assert!(namespace_allowed(&d, "authority:public:domain:child"));
    assert!(!namespace_allowed(&d, "authority:public:"));
    assert!(!namespace_allowed(&d, "authority:publicity:domain"));
    assert!(!namespace_allowed(&d, "authority:private:domain"));
    assert!(!namespace_allowed(&d, "other:authority:public"));
}
