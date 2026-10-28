//! Deterministic query/index tokenization.
//!
//! FTS5's bundled `unicode61` tokenizer treats a run of CJK characters as a
//! single token, so a quoted-phrase query for "周末徒步" matches nothing. We
//! feed unicode61 a space-separated token stream of our own making:
//!
//! - Latin/digit runs become one lowercased token ("Camino123" -> "camino123").
//! - A run of CJK/kana/hangul characters emits each unigram plus every adjacent
//!   bigram, so "徒步" indexes/search-es as both `徒` and `徒步`. Query and
//!   index use the same function, keeping the MATCH expression symmetric.
//!
//! This is plain text preprocessing over unicode61 — no custom SQLite tokenizer
//! compile dependency is introduced.

/// Whether a code point belongs to a script whose runs must be segmented into
/// n-grams rather than treated as one alphabetic word.
fn is_segmented_script(c: char) -> bool {
    // `as u32` ranges are inclusive scalar-value ranges.
    c.is_alphanumeric()
        && matches!(u32::from(c),
            0x3041..=0x3096 |   // hiragana letters
            0x309D..=0x309F |   // hiragana iteration/digraph letters
            0x30A1..=0x30FA |   // katakana letters (exclude middle dot)
            0x30FC..=0x30FF |   // length/iteration/digraph letters
            0x3400..=0x4DBF |   // CJK Ext A
            0x4E00..=0x9FFF |   // CJK unified
            0xAC00..=0xD7AF |   // hangul syllables
            0xF900..=0xFAFF |   // CJK compatibility ideographs
            0x20000..=0x2A6DF  // CJK Ext B
        )
}

/// Whether a code point continues a Latin/digit word. ASCII alphanumerics are
/// always included; other non-segmented alphanumerics (e.g. accented letters)
/// continue a word as well.
fn is_word_char(c: char) -> bool {
    !is_segmented_script(c) && c.is_alphanumeric()
}

fn push_cjk_run(run: &[char], out: &mut Vec<String>) {
    if run.is_empty() {
        return;
    }
    for c in run {
        out.push(c.to_string());
    }
    for pair in run.windows(2) {
        let mut bigram = String::with_capacity(pair[0].len_utf8() + pair[1].len_utf8());
        bigram.push(pair[0]);
        bigram.push(pair[1]);
        out.push(bigram);
    }
}

/// Tokenize text into the canonical token sequence used by both index writes
/// and query match expressions. Output is de-duplicated while preserving
/// first-seen order so repeated MATCH phrases are avoided.
pub fn tokenize(input: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut latin = String::new();
    let mut cjk: Vec<char> = Vec::new();

    fn flush_latin(latin: &mut String, out: &mut Vec<String>) {
        if !latin.is_empty() {
            out.push(std::mem::take(latin));
        }
    }
    fn flush_cjk(cjk: &mut Vec<char>, out: &mut Vec<String>) {
        if !cjk.is_empty() {
            push_cjk_run(cjk, out);
            cjk.clear();
        }
    }

    for c in input.chars() {
        if is_segmented_script(c) {
            flush_latin(&mut latin, &mut tokens);
            cjk.push(c);
        } else if is_word_char(c) {
            flush_cjk(&mut cjk, &mut tokens);
            for lower in c.to_lowercase() {
                latin.push(lower);
            }
        } else {
            flush_latin(&mut latin, &mut tokens);
            flush_cjk(&mut cjk, &mut tokens);
        }
    }
    flush_latin(&mut latin, &mut tokens);
    flush_cjk(&mut cjk, &mut tokens);

    // Stable de-dup.
    let mut seen = std::collections::HashSet::new();
    tokens.retain(|token| seen.insert(token.clone()));
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_short_terms_emit_unigram_and_bigram() {
        // The exact Chinese short-word regression from the feasibility study:
        // a two-character term must produce its bigram token.
        let tokens = tokenize("目录");
        assert!(tokens.contains(&"目".to_string()));
        assert!(tokens.contains(&"录".to_string()));
        assert!(tokens.contains(&"目录".to_string()));

        let tokens = tokenize("协议");
        assert!(tokens.contains(&"协议".to_string()));
        let tokens = tokenize("权限");
        assert!(tokens.contains(&"权限".to_string()));
    }

    #[test]
    fn cjk_phrase_emits_all_adjacent_bigrams() {
        let tokens = tokenize("周末徒步");
        for bigram in ["周末", "末徒", "徒步"] {
            assert!(tokens.contains(&bigram.to_string()), "missing {bigram}");
        }
    }

    #[test]
    fn latin_runs_are_lowercased_words() {
        assert_eq!(tokenize("Camino123"), vec!["camino123".to_string()]);
        assert_eq!(tokenize("AppImage"), vec!["appimage".to_string()]);
        assert_eq!(
            tokenize("E5-model"),
            vec!["e5".to_string(), "model".to_string()]
        );
    }

    #[test]
    fn mixed_cjk_and_latin_segments_both_scripts() {
        let tokens = tokenize("Camino山友");
        assert!(tokens.contains(&"camino".to_string()));
        assert!(tokens.contains(&"山友".to_string()));
        assert!(tokens.contains(&"山".to_string()));
    }

    #[test]
    fn handles_and_ids_keep_punctuation_out() {
        let tokens = tokenize("@alice@peers.com");
        assert_eq!(
            tokens,
            vec!["alice".to_string(), "peers".to_string(), "com".to_string()]
        );
    }

    #[test]
    fn attachment_filename_is_searchable() {
        let tokens = tokenize("林场日出.jpg");
        assert!(tokens.contains(&"林场".to_string()));
        assert!(tokens.contains(&"日出".to_string()));
        assert!(tokens.contains(&"jpg".to_string()));
    }

    #[test]
    fn empty_and_punctuation_only_produce_no_tokens() {
        assert!(tokenize("").is_empty());
        assert!(tokenize("   ... —— !!! ").is_empty());
    }

    #[test]
    fn output_is_deterministic_and_deduplicated() {
        assert_eq!(tokenize("徒步徒步"), tokenize("徒步徒步"));
        let tokens = tokenize("徒步徒步");
        assert_eq!(tokens.iter().filter(|t| *t == "徒步").count(), 1);
    }
}
