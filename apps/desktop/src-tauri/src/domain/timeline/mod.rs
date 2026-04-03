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
