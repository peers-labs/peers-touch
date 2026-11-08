package infrastructure

import (
	"reflect"
	"testing"
)

// Public object writes must be impossible through the production repository;
// the signed projector owns creation, editing and tombstones.
func TestPublicPostRepositoryHasNoObjectWriteMethods(t *testing.T) {
	repo := reflect.TypeOf(NewPublicPostRepository(nil))
	for _, name := range []string{"Create", "Delete", "Update"} {
		if _, exists := repo.MethodByName(name); exists {
			t.Fatalf("unsigned public write method remains: %s", name)
		}
	}
}
