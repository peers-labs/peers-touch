use crate::runtime::reliability_proto::peers_touch::model::mobile::v1::MobileDurableCommandState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchCandidate {
    pub command_id: String,
    pub ordering_key: String,
    pub created_at_ms: i64,
    pub expected_state: MobileDurableCommandState,
}

#[derive(Debug, Default)]
pub struct FairScheduler {
    last_served_key: Option<String>,
}

impl FairScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn select(&mut self, candidates: &[DispatchCandidate]) -> Option<DispatchCandidate> {
        if candidates.is_empty() {
            return None;
        }

        let mut ordered = candidates.to_vec();
        ordered.sort_by(|left, right| {
            left.ordering_key
                .cmp(&right.ordering_key)
                .then_with(|| left.created_at_ms.cmp(&right.created_at_ms))
                .then_with(|| left.command_id.cmp(&right.command_id))
        });
        let index = self
            .last_served_key
            .as_deref()
            .and_then(|last| {
                ordered
                    .iter()
                    .position(|candidate| candidate.ordering_key.as_str() > last)
            })
            .unwrap_or(0);
        let selected = ordered[index].clone();
        self.last_served_key = Some(selected.ordering_key.clone());
        Some(selected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(command_id: &str, ordering_key: &str, created_at_ms: i64) -> DispatchCandidate {
        DispatchCandidate {
            command_id: command_id.to_string(),
            ordering_key: ordering_key.to_string(),
            created_at_ms,
            expected_state: MobileDurableCommandState::Queued,
        }
    }

    #[test]
    fn round_robin_does_not_let_a_busy_key_starve_other_keys() {
        let mut scheduler = FairScheduler::new();
        let first_round = vec![
            candidate("a-1", "a", 1),
            candidate("b-1", "b", 2),
            candidate("c-1", "c", 3),
        ];
        assert_eq!(scheduler.select(&first_round).unwrap().ordering_key, "a");

        let second_round = vec![
            candidate("a-2", "a", 4),
            candidate("b-1", "b", 2),
            candidate("c-1", "c", 3),
        ];
        assert_eq!(scheduler.select(&second_round).unwrap().ordering_key, "b");
        assert_eq!(scheduler.select(&second_round).unwrap().ordering_key, "c");
        assert_eq!(scheduler.select(&second_round).unwrap().ordering_key, "a");
    }

    #[test]
    fn selection_is_stable_when_input_order_changes() {
        let mut scheduler = FairScheduler::new();
        let candidates = vec![
            candidate("z-1", "z", 1),
            candidate("a-1", "a", 2),
            candidate("m-1", "m", 3),
        ];
        assert_eq!(scheduler.select(&candidates).unwrap().ordering_key, "a");

        let reversed = candidates.into_iter().rev().collect::<Vec<_>>();
        assert_eq!(scheduler.select(&reversed).unwrap().ordering_key, "m");
    }
}
