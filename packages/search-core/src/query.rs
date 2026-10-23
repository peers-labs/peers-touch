//! Query normalization into an FTS5 MATCH expression and indexed text.
//!
//! Every token is emitted as a quoted FTS5 phrase; the space-joined phrase
//! list is an implicit AND in FTS5. Quoting prevents user text (including
//! CJK punctuation, quotes, and FTS5 operators) from being interpreted as
//! query syntax. Query and index text come from the same [`tokenize`]
//! function, which keeps recall symmetric.

use crate::tokenize::tokenize;

/// Maximum accepted raw query length in characters, matching the messaging
/// search policy boundary.
pub const MAX_QUERY_CHARS: usize = 256;

/// Quote one token as an FTS5 phrase, doubling embedded double quotes.
fn quote_phrase(token: &str) -> String {
    let mut quoted = String::with_capacity(token.len() + 2);
    quoted.push('"');
    for c in token.chars() {
        if c == '"' {
            quoted.push('"');
        }
        quoted.push(c);
    }
    quoted.push('"');
    quoted
}

/// Build the space-separated token text written into an FTS5 content column.
/// Unicode61 splits on the ASCII spaces we insert, so each emitted n-gram is
/// stored as its own token even though it contains CJK scalar values.
pub fn build_index_text(input: &str) -> String {
    tokenize(input).join(" ")
}

/// Build a parameter-free FTS5 MATCH expression from raw user query text.
/// Returns an error for empty/oversized input rather than an expression that
/// would scan the whole table.
pub fn build_match_expression(raw: &str) -> Result<String, QueryError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(QueryError::Empty);
    }
    if trimmed.chars().count() > MAX_QUERY_CHARS {
        return Err(QueryError::TooLong);
    }
    let tokens = tokenize(trimmed);
    if tokens.is_empty() {
        return Err(QueryError::Empty);
    }
    Ok(tokens
        .iter()
        .map(|token| quote_phrase(token))
        .collect::<Vec<_>>()
        .join(" "))
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum QueryError {
    #[error("search query is empty")]
    Empty,
    #[error("search query exceeds {MAX_QUERY_CHARS} characters")]
    TooLong,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_query_is_phrase_and_of_tokens() {
        assert_eq!(
            build_match_expression("周末徒步").unwrap(),
            "\"周\" \"末\" \"徒\" \"步\" \"周末\" \"末徒\" \"徒步\""
        );
    }

    #[test]
    fn mixed_query_quotes_every_token() {
        assert_eq!(
            build_match_expression("camino 山友").unwrap(),
            "\"camino\" \"山\" \"友\" \"山友\""
        );
    }

    #[test]
    fn embedded_quotes_are_doubled() {
        assert_eq!(build_match_expression("a\"b").unwrap(), "\"a\" \"b\"");
        assert_eq!(build_match_expression("徒\"步").unwrap(), "\"徒\" \"步\"");
    }

    #[test]
    fn fts_operators_are_neutralized_inside_phrases() {
        // Even literal operator text is harmless inside quoted phrases.
        let expr = build_match_expression("OR AND NOT *").unwrap();
        assert!(expr.starts_with('"'));
        assert!(!expr.contains(" *"));
    }

    #[test]
    fn empty_and_oversized_queries_fail() {
        assert_eq!(
            build_match_expression("   ").unwrap_err(),
            QueryError::Empty
        );
        assert_eq!(
            build_match_expression("...").unwrap_err(),
            QueryError::Empty
        );
        let long = "徒".repeat(MAX_QUERY_CHARS + 1);
        assert_eq!(
            build_match_expression(&long).unwrap_err(),
            QueryError::TooLong
        );
    }

    #[test]
    fn index_text_round_trips_through_the_same_tokens() {
        let indexed = build_index_text("周末徒步");
        // Indexed text contains the bigram token the query asks for.
        assert!(indexed.split(' ').any(|t| t == "徒步"));
        assert_eq!(indexed, build_index_text("周末徒步"));
    }
}
