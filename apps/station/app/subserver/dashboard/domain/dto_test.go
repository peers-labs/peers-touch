package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPeersActorDTOsExposeOnlyPTID(t *testing.T) {
	tests := []struct {
		name      string
		value     any
		wantField string
		forbidden []string
	}{
		{
			name:      "actor summary",
			value:     ActorSummary{PTID: "ptid:alice"},
			wantField: `"ptid":"ptid:alice"`,
			forbidden: []string{`"id":`, `"actor_id":`, `"user_id":`},
		},
		{
			name:      "actor detail",
			value:     ActorDetail{PTID: "ptid:alice"},
			wantField: `"ptid":"ptid:alice"`,
			forbidden: []string{`"id":`, `"actor_id":`, `"user_id":`},
		},
		{
			name:      "peers session",
			value:     PeersSessionInfo{ActorPTID: "ptid:alice"},
			wantField: `"actor_ptid":"ptid:alice"`,
			forbidden: []string{`"actor_id":`, `"user_id":`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload, err := json.Marshal(tt.value)
			if err != nil {
				t.Fatalf("marshal DTO: %v", err)
			}
			body := string(payload)
			if !strings.Contains(body, tt.wantField) {
				t.Fatalf("payload %s does not contain %s", body, tt.wantField)
			}
			for _, field := range tt.forbidden {
				if strings.Contains(body, field) {
					t.Fatalf("payload %s contains forbidden field %s", body, field)
				}
			}
		})
	}
}

func TestDashboardAdminDTOKeepsLocalNumericID(t *testing.T) {
	payload, err := json.Marshal(AdminInfo{ID: 7, Username: "operator"})
	if err != nil {
		t.Fatalf("marshal admin DTO: %v", err)
	}
	if !strings.Contains(string(payload), `"id":7`) {
		t.Fatalf("dashboard-local admin ID missing from payload: %s", payload)
	}
}
