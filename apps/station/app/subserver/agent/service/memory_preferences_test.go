package service

import "testing"

func TestMemoryPreferencesRetainExplicitDisabledAndZeroWeights(t *testing.T) {
	preferences, err := memoryPreferences(`{"memory":{"enabled":false,"tuningEnabled":false,"vectorWeight":0,"keywordWeight":1,"effort":"high"}}`)
	if err != nil {
		t.Fatal(err)
	}
	if preferences.GetEnabled() || preferences.GetTuningEnabled() ||
		preferences.GetVectorWeight() != 0 || preferences.GetKeywordWeight() != 1 ||
		preferences.GetEffort() != "high" {
		t.Fatalf("explicit policy lost: %v", preferences)
	}
}

func TestMemoryPreferencesInheritMissingFields(t *testing.T) {
	preferences, err := memoryPreferences(`{"memory":{"enabled":false,"effort":"low","embeddingModel":"existing"}}`)
	if err != nil {
		t.Fatal(err)
	}
	if preferences.GetEnabled() || !preferences.GetTuningEnabled() ||
		preferences.GetVectorWeight() != 0.55 || preferences.GetKeywordWeight() != 0.45 ||
		preferences.GetEffort() != "low" {
		t.Fatalf("legacy policy lost: %v", preferences)
	}
}

func TestMemoryPreferencesRejectInvalidConfiguration(t *testing.T) {
	for _, config := range []string{
		`[]`, `{"memory":{"enabled":"no"}}`, `{"memory":{"vectorWeight":0,"keywordWeight":0}}`,
		`{"memory":{"vectorWeight":2}}`, `{"memory":{"vectorWeight":"NaN"}}`,
	} {
		if _, err := memoryPreferences(config); err == nil {
			t.Fatalf("accepted invalid memory policy: %s", config)
		}
	}
}
