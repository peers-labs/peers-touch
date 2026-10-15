package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

// Missing policy fields preserve the existing Station behavior. A policy is
// owned by an Agent, never copied into a device preference store.
func memoryPreferences(configJSON string) (*model.MemoryPreferences, error) {
	preferences := &model.MemoryPreferences{
		Enabled:       proto.Bool(true),
		TuningEnabled: proto.Bool(true),
		VectorWeight:  proto.Float64(0.55),
		KeywordWeight: proto.Float64(0.45),
	}
	var config map[string]json.RawMessage
	if configJSON != "" {
		if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
			return nil, invalidMemoryPreferences(err)
		}
	}
	if raw, exists := config["memory"]; exists {
		var saved model.MemoryPreferences
		if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(raw, &saved); err != nil {
			return nil, invalidMemoryPreferences(err)
		}
		proto.Merge(preferences, &saved)
	}
	if err := validateMemoryPreferences(preferences); err != nil {
		return nil, err
	}
	return preferences, nil
}

func validateMemoryPreferences(preferences *model.MemoryPreferences) error {
	vector, keyword := preferences.GetVectorWeight(), preferences.GetKeywordWeight()
	if math.IsNaN(vector) || math.IsNaN(keyword) || math.IsInf(vector, 0) || math.IsInf(keyword, 0) ||
		vector < 0 || keyword < 0 || vector > 1 || keyword > 1 || vector+keyword <= 0 {
		return invalidMemoryPreferences(nil)
	}
	switch preferences.GetEffort() {
	case "", "low", "medium", "high":
		return nil
	default:
		return invalidMemoryPreferences(nil)
	}
}

func invalidMemoryPreferences(cause error) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid Agent memory preferences", cause)
}

func (s *MemoryService) preferences(ctx context.Context, agentID string) (*model.MemoryPreferences, error) {
	if agentID == "" {
		return memoryPreferences("")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var agent persistence.Agent
	err = db.WithContext(ctx).Select("config_json").Where("id = ?", agentID).First(&agent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return memoryPreferences("")
	}
	if err != nil {
		return nil, errcode.New(errcode.AgentInternal, http.StatusInternalServerError, "load Agent memory preferences", err)
	}
	return memoryPreferences(agent.ConfigJSON)
}
