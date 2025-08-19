package id

import (
	"testing"
)

func TestNextID(t *testing.T) {
	// Test that NextID generates valid IDs
	for i := 0; i < 5; i++ {
		id := NextID()
		if id == 0 {
			t.Errorf("NextID() returned 0, expected non-zero ID")
		}
		t.Logf("Generated ID %d: %d", i+1, id)
	}
}

func TestNextIDUniqueness(t *testing.T) {
	// Test that consecutive IDs are unique
	ids := make(map[uint64]bool)
	for i := 0; i < 100; i++ {
		id := NextID()
		if ids[id] {
			t.Errorf("Duplicate ID generated: %d", id)
		}
		ids[id] = true
	}
	t.Logf("Generated %d unique IDs successfully", len(ids))
}

func TestNextIDIncreasing(t *testing.T) {
	// Test that IDs are generally increasing (due to timestamp component)
	prevID := NextID()
	for i := 0; i < 10; i++ {
		currentID := NextID()
		if currentID <= prevID {
			t.Errorf("ID not increasing: prev=%d, current=%d", prevID, currentID)
		}
		prevID = currentID
	}
}

func BenchmarkNextID(b *testing.B) {
	// Benchmark ID generation performance
	for i := 0; i < b.N; i++ {
		NextID()
	}
}
