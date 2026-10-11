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

func TestOrderedStartedSubserverNamesStartsFederationLast(t *testing.T) {
	subservers := map[string]Subserver{
		"federation":   nil,
		"conversation": nil,
		"social":       nil,
		"actor":        nil,
	}

	got := orderedStartedSubserverNames(subservers)
	want := []string{"actor", "conversation", "social", "federation"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ordered started subservers = %v, want %v", got, want)
	}
}

func TestRegisterSubserverUsesRegistrationName(t *testing.T) {
	base := &BaseServer{
		opts: &Options{
			SubserverInstances: map[string]Subserver{},
		},
		subServers: map[string]Subserver{},
	}

	base.registerSubserver("bootstrap", nil)

	if _, ok := base.subServers["bootstrap"]; !ok {
		t.Fatal("lifecycle map omitted the registration name")
	}
	if _, ok := base.opts.SubserverInstances["bootstrap"]; !ok {
		t.Fatal("instance map omitted the registration name")
	}
}
