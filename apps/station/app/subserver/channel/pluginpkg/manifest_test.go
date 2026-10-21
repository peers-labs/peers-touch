package pluginpkg

import (
	"strings"
	"testing"
)

func validManifestJSON(platform string) string {
	return `{
		"schemaVersion": 1,
		"id": "lark",
		"name": "Lark",
		"version": "0.1.0",
		"providerKind": "lark",
		"entry": {"` + platform + `": {"path": "bin/plugin"}},
		"capabilities": ["messaging.receive", "messaging.longconn"],
		"protocol": {"min": 1, "max": 1}
	}`
}

func TestParseManifestValid(t *testing.T) {
	m, entry, err := ParseManifest([]byte(validManifestJSON(PlatformKey())))
	if err != nil {
		t.Fatalf("ParseManifest: %v", err)
	}
	if m.ID != "lark" || entry.Path != "bin/plugin" {
		t.Fatalf("unexpected parse: %+v %+v", m, entry)
	}
}

func TestParseManifestRejectsProblems(t *testing.T) {
	cases := map[string]string{
		"bad schema version": strings.Replace(validManifestJSON(PlatformKey()), `"schemaVersion": 1`, `"schemaVersion": 9`, 1),
		"bad id":             strings.Replace(validManifestJSON(PlatformKey()), `"id": "lark"`, `"id": "Bad_ID"`, 1),
		"unknown capability": strings.Replace(validManifestJSON(PlatformKey()), "messaging.receive", "evil.exec", 1),
		"bad protocol range": strings.Replace(validManifestJSON(PlatformKey()), `"min": 1, "max": 1`, `"min": 2, "max": 1`, 1),
		"missing platform":   validManifestJSON("plan9/amd64"),
		"missing name":       strings.Replace(validManifestJSON(PlatformKey()), `"name": "Lark"`, `"name": ""`, 1),
		"invalid json":       `{not json`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, err := ParseManifest([]byte(raw)); err == nil {
				t.Fatal("expected lint error")
			}
		})
	}
}
