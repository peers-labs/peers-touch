// Four-key fair scheduling for command dispatch.
//
// The scheduler round-robins across `CommandCategory` queues so that
// a flood in one category (e.g. rapid chat messages) cannot starve
// the others.  Within each category, commands sharing the same
// `ordering_key` are dispatched in FIFO order to preserve
// per-conversation / per-entity causality.

use std::collections::VecDeque;

use super::entry::{CommandCategory, CommandEntry};

/// Fair scheduler state.
///
/// Maintains a per-category FIFO and a round-robin cursor.
/// The caller fills queues via `enqueue` and drains via `next`.
pub struct FairScheduler {
    queues: [VecDeque<CommandEntry>; 4],
    cursor: usize,
}

impl FairScheduler {
    pub fn new() -> Self {
        Self {
            queues: [
                VecDeque::new(),
                VecDeque::new(),
                VecDeque::new(),
                VecDeque::new(),
            ],
            cursor: 0,
        }
    }

    /// Enqueue a command into its category's FIFO.
    pub fn enqueue(&mut self, entry: CommandEntry) {
        let index = category_index(entry.category);
        self.queues[index].push_back(entry);
    }

    /// Dequeue the next command using round-robin fairness.
    ///
    /// Cycles through categories starting from the current cursor.
    /// Returns `None` when all queues are empty.
    pub fn next(&mut self) -> Option<CommandEntry> {
        let start = self.cursor;
        for offset in 0..CommandCategory::ALL.len() {
            let index = (start + offset) % CommandCategory::ALL.len();
            if let Some(entry) = self.queues[index].pop_front() {
                // Advance cursor past the category we just served
                // so the next call starts at the following category.
                self.cursor = (index + 1) % CommandCategory::ALL.len();
                return Some(entry);
            }
        }
        None
    }

    /// Total number of entries across all queues.
    pub fn len(&self) -> usize {
        self.queues.iter().map(|q| q.len()).sum()
    }

    /// Whether all queues are empty.
    pub fn is_empty(&self) -> bool {
        self.queues.iter().all(|q| q.is_empty())
    }

    /// Number of entries in a specific category queue.
    pub fn category_len(&self, category: CommandCategory) -> usize {
        self.queues[category_index(category)].len()
    }

    /// Clear all queues and reset the cursor.
    pub fn clear(&mut self) {
        for queue in &mut self.queues {
            queue.clear();
        }
        self.cursor = 0;
    }
}

fn category_index(category: CommandCategory) -> usize {
    match category {
        CommandCategory::Chat => 0,
        CommandCategory::Social => 1,
        CommandCategory::Moments => 2,
        CommandCategory::System => 3,
    }
}
