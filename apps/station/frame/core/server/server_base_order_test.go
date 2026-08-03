package server

import (
	"reflect"
	"testing"
)

func TestOrderedSubserverNamesInitializesBootstrapFirst(t *testing.T) {
	subservers := map[string]subServerNewFunctions{
		"conversation": {},
		"bootstrap":    {},
		"envelope":     {},
		"actor":        {},
	}

	got := orderedSubserverNames(subservers)
	want := []string{"bootstrap", "actor", "conversation", "envelope"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ordered subservers = %v, want %v", got, want)
	}
}
