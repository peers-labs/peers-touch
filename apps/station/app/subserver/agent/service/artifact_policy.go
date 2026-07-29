package service

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

const artifactURIPrefix = "artifact://"

func stationArtifactURI(taskID string, artifactID string) string {
	taskID = strings.TrimSpace(taskID)
	artifactID = strings.TrimSpace(artifactID)
	if taskID == "" || artifactID == "" {
		return ""
	}
	return artifactURIPrefix + taskID + "/" + artifactID
}

func artifactContentChecksum(content string) string {
	sum := sha256.Sum256([]byte(content))
	return fmt.Sprintf("sha256:%x", sum)
}

func validateArtifactEvidencePolicy(payload map[string]interface{}, taskID string, field string) error {
	artifactID := firstPayloadString(payload, "artifact_id", "artifactId", "id")
	if artifactID == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+".artifact_id is required", nil)
	}

	uri := firstPayloadString(payload, "uri", "url", "src")
	expectedURI := stationArtifactURI(taskID, artifactID)
	if uri == "" {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+".uri is required", nil)
	}
	if expectedURI == "" || uri != expectedURI {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+".uri must be artifact://<task_id>/<artifact_id>", nil)
	}

	checksum := firstPayloadString(payload, "checksum", "sha256")
	if !isSHA256Checksum(checksum) {
		return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+".checksum must be sha256:<64 hex chars>", nil)
	}

	return validateArtifactRefsPolicy(payload, artifactID, field)
}

func validateArtifactRefsPolicy(payload map[string]interface{}, artifactID string, field string) error {
	for _, key := range []string{"refs", "artifact_refs", "artifactRefs"} {
		value, ok := payload[key]
		if !ok || value == nil {
			continue
		}
		items, ok := value.([]interface{})
		if !ok {
			return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+"."+key+" must be a string array", nil)
		}
		for _, item := range items {
			ref, ok := item.(string)
			if !ok {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+"."+key+" must contain only strings", nil)
			}
			ref = strings.TrimSpace(ref)
			if ref == "" {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+"."+key+" must not contain empty refs", nil)
			}
			if ref == artifactID {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+"."+key+" must not self-reference artifact_id", nil)
			}
			if strings.HasPrefix(ref, artifactURIPrefix) {
				return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, field+"."+key+" must contain artifact ids, not artifact URIs", nil)
			}
		}
	}
	return nil
}

func isSHA256Checksum(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != len("sha256:")+64 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	for _, char := range value[len("sha256:"):] {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F') {
			continue
		}
		return false
	}
	return true
}
