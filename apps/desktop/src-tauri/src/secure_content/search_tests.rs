use super::*;

// Store-only fixtures prove integrity/index behavior, not remote authority.
impl SecureContentStore {
    fn search_documents(
        &self,
        query: &str,
        kinds: &[ResultKind],
        before: Option<(i64, &str, &str)>,
        limit: usize,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Vec<ScoredDocument>, String> {
        let refs = self
            .search_candidate_refs(query, kinds, before, limit, check)?
            .resources;
        let mut documents = self.search_read_resources(&refs, check)?;
        documents.sort_by_key(|doc| {
            refs.iter().position(|resource| {
                resource.kind == doc.resource.kind && resource.id == doc.resource.id
            })
        });
        Ok(documents)
    }

    fn read_test_target_window(
        &self,
        post_id: &str,
        anchor: Option<&str>,
        limit: usize,
        check: &(dyn Fn() -> Result<(), String> + Sync),
    ) -> Result<Option<SearchTargetWindow>, String> {
        let refs = self.search_target_refs(post_id, anchor, limit, check)?;
        self.search_read_target_window(post_id, anchor, &refs, check)
    }
}

#[test]
fn private_social_search_sql_vm_interrupts_before_returning_a_result_row() {
    let store = SecureContentStore::in_memory().unwrap();
    let connection = store.connection().unwrap();
    let started = std::time::Instant::now();
    let check = || {
        if started.elapsed() >= Duration::from_millis(30) {
            Err("read deadline expired".to_string())
        } else {
            Ok(())
        }
    };
    let result = bounded_sql_read(&connection, &check, || {
        connection.query_row(
            "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 100000000)
             SELECT SUM(x) FROM n",
            [], |row| row.get::<_, i64>(0),
        ).map_err(|error| error.to_string())
    });
    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(1));
}

fn post(id: &str, generation: u64, text: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "post_id": id, "content_id": format!("content-{id}"),
        "generation": generation.to_string(), "author_ptid": "ptid:author",
        "audience_kind": "DIRECT", "state": "CONTENT_READY",
        "content": { "kind": "TEXT", "text": text }, "created_at_millis": 42,
    }))
    .unwrap()
}

fn comment(post_id: &str, id: &str, generation: u64, text: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "comment_id": id, "post_id": post_id, "content_id": format!("content-{id}"),
        "generation": generation.to_string(), "reply_to_comment_id": "",
        "author_ptid": "ptid:author", "state": "COMMENT_POSTED", "text": text,
        "reactions_count": 0, "replies_count": 0, "created_at_millis": 42,
    }))
    .unwrap()
}

fn commit_post(store: &SecureContentStore, id: &str, generation: u64, text: &str) {
    store
        .commit_content_root(
            &format!("content-{id}"),
            generation,
            id,
            &[7; 32],
            None,
            &post(id, generation, text),
        )
        .unwrap();
}

fn commit_comment(store: &SecureContentStore, post_id: &str, id: &str, text: &str) {
    store
        .commit_comment_root(
            &format!("content-{id}"),
            1,
            post_id,
            id,
            &[8; 32],
            None,
            &comment(post_id, id, 1, text),
        )
        .unwrap();
}

#[test]
fn private_social_search_duplicate_projection_preserves_read_revision() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_post(&store, "post-1", 1, "needle");
    commit_comment(&store, "post-1", "comment-1", "needle");
    let revision = store.search_revision().unwrap();
    let references = store
        .search_candidate_refs("needle", &[], None, 10, &|| Ok(()))
        .unwrap()
        .resources;
    commit_post(&store, "post-1", 1, "needle");
    commit_comment(&store, "post-1", "comment-1", "needle");
    assert_eq!(store.search_revision().unwrap(), revision);
    assert_eq!(
        store
            .search_read_resources(&references, &|| Ok(()))
            .unwrap()
            .len(),
        2
    );
    commit_post(&store, "post-1", 1, "changed");
    assert_ne!(store.search_revision().unwrap(), revision);
    assert_eq!(
        store
            .with_search_revision(&revision, || Ok(()))
            .unwrap_err(),
        SearchError::SourceChanged
    );
    store.mark_private_resource_purge_pending("post-1").unwrap();
    assert!(store
        .commit_comment_root(
            "content-comment-1",
            1,
            "post-1",
            "comment-1",
            &[8; 32],
            None,
            &comment("post-1", "comment-1", 1, "needle"),
        )
        .is_err());
}

#[test]
fn private_social_search_cjk_kinds_and_canonical_comment_reference() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_post(&store, "post-1", 1, "\u{5f92}\u{6b65} Camino");
    commit_comment(&store, "post-1", "comment-1", "\u{5f92}\u{6b65} Camino");
    let documents = store
        .search_documents("\u{5f92}\u{6b65} camino", &[], None, 100, &|| Ok(()))
        .unwrap();
    assert_eq!(documents.len(), 2);
    let resource = &documents
        .iter()
        .find(|d| d.kind == ResultKind::SocialComment)
        .unwrap()
        .resource;
    assert_eq!(resource.kind, "social-comment");
    assert_eq!(resource.id, "comment-1");
    assert_eq!(resource.authority_namespace, "social");
    assert_eq!(resource.anchor.as_ref().unwrap().kind, "comment");
    assert_eq!(resource.anchor.as_ref().unwrap().id, "comment-1");
    let parent = resource.parent.as_ref().unwrap();
    assert_eq!(parent.kind, "social-post");
    assert_eq!(parent.id, "post-1");
    assert_eq!(parent.authority_namespace, resource.authority_namespace);
    assert_eq!(
        store
            .search_documents("camino", &[ResultKind::SocialPost], None, 1, &|| Ok(()))
            .unwrap()
            .len(),
        1
    );
    assert!(store
        .search_documents("camino", &[ResultKind::Message], None, 1, &|| Ok(()))
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .search_read_resources(&[resource.clone()], &|| Ok(()))
            .unwrap()
            .len(),
        1
    );
    let mut forged = resource.clone();
    forged.parent.as_mut().unwrap().id = "other-post".to_string();
    assert!(store
        .search_read_resources(&[forged], &|| Ok(()))
        .unwrap()
        .is_empty());
    assert!(store
        .search_documents("...", &[], None, 10, &|| Ok(()))
        .is_err());
    assert!(store
        .search_documents("camino", &[], None, 101, &|| Ok(()))
        .is_err());
}

#[test]
fn private_social_search_revoke_blocks_late_post_and_comment_upserts_atomically() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_post(&store, "post-1", 1, "needle");
    commit_comment(&store, "post-1", "comment-1", "needle");
    let revision = store.search_revision().unwrap();
    store.mark_private_resource_purge_pending("post-1").unwrap();
    assert!(store
        .search_documents("needle", &[], None, 10, &|| Ok(()))
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .with_search_revision(&revision, || Ok(()))
            .unwrap_err(),
        SearchError::SourceChanged
    );
    store.purge_private_resource_material("post-1").unwrap();
    assert!(store
        .commit_content_root(
            "content-post-1",
            2,
            "post-1",
            &[7; 32],
            None,
            &post("post-1", 2, "needle"),
        )
        .is_err());
    assert!(store
        .commit_comment_root(
            "content-comment-2",
            1,
            "post-1",
            "comment-2",
            &[8; 32],
            None,
            &comment("post-1", "comment-2", 1, "needle"),
        )
        .is_err());
    assert!(store.projection("post-1").unwrap().is_none());
    assert!(store
        .comment_projection("post-1", "comment-1")
        .unwrap()
        .is_none());
    assert!(store.content_root("content-post-1", 2).unwrap().is_none());
    let terms: i64 = store
        .connection()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM secure_content_social_search_fts",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(terms, 0);
    // The original typed failure may be returned after purge without storing it.
    store.save_projection("post-1", b"{}").unwrap();
    assert!(store.projection("post-1").unwrap().is_none());
}

#[test]
fn private_social_search_policy_gap_invalidates_inflight_source_without_inventing_grants() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_post(&store, "post-1", 1, "needle");
    let revision = store.search_revision().unwrap();
    store.invalidate_search_policy().unwrap();
    assert_eq!(
        store
            .with_search_revision(&revision, || Ok(()))
            .unwrap_err(),
        SearchError::SourceChanged
    );
    // Integrity-ready candidates survive uncertainty; only a fresh remote
    // policy batch can authorize the binding reader to decode and return them.
    assert_eq!(
        store
            .search_candidate_refs("needle", &[], None, 10, &|| Ok(()))
            .unwrap()
            .resources
            .len(),
        1
    );
    let revision = store.search_revision().unwrap();
    store.bind_session_generation(2).unwrap();
    assert_eq!(
        store
            .with_search_revision(&revision, || Ok(()))
            .unwrap_err(),
        SearchError::SourceChanged
    );
}

#[test]
fn private_social_search_unavailable_parent_and_missing_key_fail_closed() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_comment(&store, "post-1", "comment-1", "needle");
    assert!(store
        .search_documents("needle", &[], None, 10, &|| Ok(()))
        .unwrap()
        .is_empty());
    commit_post(&store, "post-1", 1, "needle");
    assert_eq!(
        store
            .search_documents("needle", &[], None, 10, &|| Ok(()))
            .unwrap()
            .len(),
        2
    );
    let mut unavailable: serde_json::Value =
        serde_json::from_slice(&post("post-1", 1, "needle")).unwrap();
    unavailable["state"] = serde_json::json!("REMOTE_SOURCE_UNAVAILABLE");
    store
        .save_projection("post-1", &serde_json::to_vec(&unavailable).unwrap())
        .unwrap();
    assert!(store
        .search_documents("needle", &[], None, 10, &|| Ok(()))
        .unwrap()
        .is_empty());
    commit_post(&store, "post-1", 1, "needle");
    store
        .connection()
        .unwrap()
        .execute("DELETE FROM secure_content_roots", [])
        .unwrap();
    assert!(store
        .search_documents("needle", &[], None, 10, &|| Ok(()))
        .unwrap()
        .is_empty());
    assert!(store
        .read_test_target_window("post-1", Some("comment-1"), 5, &|| Ok(()))
        .unwrap()
        .is_none());
}

#[test]
fn private_social_search_keyset_and_anchor_window_pass_the_first_page() {
    let store = SecureContentStore::in_memory().unwrap();
    commit_post(&store, "post-1", 1, "needle");
    for number in 0..155 {
        commit_comment(&store, "post-1", &format!("comment-{number:03}"), "needle");
    }
    let first = store
        .search_documents(
            "needle",
            &[ResultKind::SocialComment],
            None,
            100,
            &|| Ok(()),
        )
        .unwrap();
    let boundary = first.last().unwrap();
    let second = store
        .search_documents(
            "needle",
            &[ResultKind::SocialComment],
            Some((
                boundary.created_at_unix_ms,
                &boundary.resource.kind,
                &boundary.resource.id,
            )),
            100,
            &|| Ok(()),
        )
        .unwrap();
    assert_eq!(first.len(), 100);
    assert_eq!(second.len(), 55);
    assert!(!first
        .iter()
        .any(|a| second.iter().any(|b| a.resource.id == b.resource.id)));
    let window = store
        .read_test_target_window("post-1", Some("comment-150"), 5, &|| Ok(()))
        .unwrap()
        .unwrap();
    let ids: Vec<String> = window
        .comment_projections
        .iter()
        .map(|bytes| {
            serde_json::from_slice::<serde_json::Value>(bytes).unwrap()["comment_id"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        ids,
        [
            "comment-148",
            "comment-149",
            "comment-150",
            "comment-151",
            "comment-152"
        ]
    );
    store
        .purge_private_comment_material("post-1", "comment-150")
        .unwrap();
    assert!(store
        .read_test_target_window("post-1", Some("comment-150"), 5, &|| Ok(()))
        .unwrap()
        .is_none());
    assert!(store
        .commit_comment_root(
            "content-comment-150",
            2,
            "post-1",
            "comment-150",
            &[8; 32],
            None,
            &comment("post-1", "comment-150", 2, "needle"),
        )
        .is_err());
}

#[test]
fn private_social_search_backfill_is_bounded_transactional_and_not_a_read_grant() {
    let store = SecureContentStore::in_memory().unwrap();
    {
        let mut connection = store.connection().unwrap();
        let transaction = connection.transaction().unwrap();
        for number in 0..140 {
            let id = format!("post-{number:03}");
            transaction
                .execute(
                    "INSERT INTO secure_content_moment_projections
                 (post_id, content_id, generation, projection_bytes, updated_at_unix_ms)
                 VALUES(?1, ?2, 1, ?3, 42)",
                    params![id, format!("content-{id}"), post(&id, 1, "needle")],
                )
                .unwrap();
        }
        transaction
            .execute(
                "UPDATE secure_content_search_state SET posts_snapshot =
             (SELECT MAX(rowid) FROM secure_content_moment_projections), ready = 0",
                [],
            )
            .unwrap();
        transaction.commit().unwrap();
    }
    let calls = std::sync::atomic::AtomicUsize::new(0);
    assert!(store
        .search_backfill_batch(128, &|| {
            if calls.fetch_add(1, Ordering::Relaxed) >= 3 {
                Err("cancelled".to_string())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert_eq!(store.search_index_progress().unwrap().posts_through, 0);
    let first = store.search_backfill_batch(128, &|| Ok(())).unwrap();
    assert!(!first.ready);
    assert_eq!(first.posts_through, 128);
    assert!(store.search_backfill_batch(128, &|| Ok(())).unwrap().ready);
    assert!(store
        .search_documents("needle", &[], None, 100, &|| Ok(()))
        .unwrap()
        .is_empty());
    commit_post(&store, "post-139", 1, "needle");
    assert_eq!(
        store
            .search_documents("needle", &[], None, 100, &|| Ok(()))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn private_social_search_prekey_failure_rolls_back_projection_and_fts() {
    let store = SecureContentStore::in_memory().unwrap();
    let revision = store.search_revision().unwrap();
    assert!(store
        .commit_content_root(
            "content-post-1",
            1,
            "post-1",
            &[7; 32],
            Some("missing-prekey"),
            &post("post-1", 1, "needle"),
        )
        .is_err());
    assert_eq!(store.search_revision().unwrap(), revision);
    assert!(store.projection("post-1").unwrap().is_none());
    assert!(store.content_root("content-post-1", 1).unwrap().is_none());
    commit_post(&store, "post-1", 2, "newer");
    assert!(store
        .commit_content_root(
            "content-post-1",
            1,
            "post-1",
            &[7; 32],
            None,
            &post("post-1", 1, "older"),
        )
        .is_err());
    assert!(store
        .search_documents("older", &[], None, 10, &|| Ok(()))
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .search_documents("newer", &[], None, 10, &|| Ok(()))
            .unwrap()
            .len(),
        1
    );
}
