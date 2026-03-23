use std::sync::{LazyLock, Mutex};

#[derive(Clone)]
struct TimelinePost {
    id: String,
    like_count: u32,
    comment_count: u32,
    repost_count: u32,
    liked_by_me: bool,
}

struct TimelineStore {
    posts: Vec<TimelinePost>,
}

impl Default for TimelineStore {
    fn default() -> Self {
        Self {
            posts: vec![
                TimelinePost {
                    id: "post-1001".to_string(),
                    like_count: 12,
                    comment_count: 3,
                    repost_count: 1,
                    liked_by_me: false,
                },
                TimelinePost {
                    id: "post-1002".to_string(),
                    like_count: 7,
                    comment_count: 1,
                    repost_count: 0,
                    liked_by_me: false,
                },
                TimelinePost {
                    id: "post-1003".to_string(),
                    like_count: 3,
                    comment_count: 0,
                    repost_count: 0,
                    liked_by_me: false,
                },
            ],
        }
    }
}

static TIMELINE_STORE: LazyLock<Mutex<TimelineStore>> =
    LazyLock::new(|| Mutex::new(TimelineStore::default()));

#[derive(Debug)]
pub enum TimelineError {
    InvalidArgument(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

pub struct TimelineListOutcome {
    pub fetched: usize,
    pub next_cursor: Option<String>,
    pub post_ids: Vec<String>,
}

pub struct TimelineActionOutcome {
    pub post_id: String,
    pub state: String,
    pub like_count: u32,
    pub comment_count: u32,
    pub repost_count: u32,
    pub rolled_back: bool,
}

pub fn list(cursor: Option<&str>, limit: Option<u32>) -> Result<TimelineListOutcome, TimelineError> {
    let limit_value = limit.unwrap_or(20).clamp(1, 50) as usize;
    let start = parse_cursor(cursor)?;
    let store = TIMELINE_STORE
        .lock()
        .map_err(|_| TimelineError::Internal("failed to lock timeline store".to_string()))?;
    if start > store.posts.len() {
        return Err(TimelineError::InvalidArgument("cursor out of range".to_string()));
    }
    let end = (start + limit_value).min(store.posts.len());
    let slice = &store.posts[start..end];
    let post_ids = slice.iter().map(|post| post.id.clone()).collect::<Vec<_>>();
    let next_cursor = (end < store.posts.len()).then_some(end.to_string());
    Ok(TimelineListOutcome {
        fetched: slice.len(),
        next_cursor,
        post_ids,
    })
}

pub fn like(post_id: &str) -> Result<TimelineActionOutcome, TimelineError> {
    with_optimistic_update(post_id, None, |post| {
        if post.liked_by_me {
            post.liked_by_me = false;
            if post.like_count > 0 {
                post.like_count -= 1;
            }
            "unliked".to_string()
        } else {
            post.liked_by_me = true;
            post.like_count += 1;
            "liked".to_string()
        }
    })
}

pub fn comment(post_id: &str, content: &str) -> Result<TimelineActionOutcome, TimelineError> {
    if content.trim().is_empty() {
        return Err(TimelineError::InvalidArgument(
            "comment content is required".to_string(),
        ));
    }
    with_optimistic_update(post_id, Some(content), |post| {
        post.comment_count += 1;
        "commented".to_string()
    })
}

pub fn repost(post_id: &str, content: Option<&str>) -> Result<TimelineActionOutcome, TimelineError> {
    if let Some(value) = content {
        if value.len() > 500 {
            return Err(TimelineError::InvalidArgument(
                "repost content is too long".to_string(),
            ));
        }
    }
    with_optimistic_update(post_id, content, |post| {
        post.repost_count += 1;
        "reposted".to_string()
    })
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize, TimelineError> {
    let Some(value) = cursor else {
        return Ok(0);
    };
    value
        .trim()
        .parse::<usize>()
        .map_err(|_| TimelineError::InvalidArgument("cursor must be numeric".to_string()))
}

fn with_optimistic_update<F>(
    post_id: &str,
    content: Option<&str>,
    apply: F,
) -> Result<TimelineActionOutcome, TimelineError>
where
    F: FnOnce(&mut TimelinePost) -> String,
{
    let normalized_id = post_id.trim();
    if normalized_id.is_empty() {
        return Err(TimelineError::InvalidArgument("post_id is required".to_string()));
    }
    let mut store = TIMELINE_STORE
        .lock()
        .map_err(|_| TimelineError::Internal("failed to lock timeline store".to_string()))?;
    let index = store
        .posts
        .iter()
        .position(|post| post.id == normalized_id)
        .ok_or_else(|| TimelineError::NotFound("post not found".to_string()))?;
    let snapshot = store.posts[index].clone();
    let state = apply(&mut store.posts[index]);
    if should_fail(normalized_id, content) {
        store.posts[index] = snapshot.clone();
        return Ok(TimelineActionOutcome {
            post_id: snapshot.id,
            state: "rolled_back".to_string(),
            like_count: snapshot.like_count,
            comment_count: snapshot.comment_count,
            repost_count: snapshot.repost_count,
            rolled_back: true,
        });
    }
    let current = &store.posts[index];
    Ok(TimelineActionOutcome {
        post_id: current.id.clone(),
        state,
        like_count: current.like_count,
        comment_count: current.comment_count,
        repost_count: current.repost_count,
        rolled_back: false,
    })
}

fn should_fail(post_id: &str, content: Option<&str>) -> bool {
    if post_id.to_ascii_lowercase().contains("rollback") {
        return true;
    }
    if let Some(value) = content {
        return value.to_ascii_lowercase().contains("#rollback");
    }
    false
}
