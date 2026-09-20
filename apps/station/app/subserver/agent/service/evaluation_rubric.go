package service

import (
	"fmt"
	"strings"
)

const (
	evaluationRubricExactMatch              = "exact_match"
	evaluationRubricCaseInsensitiveContains = "case_insensitive_contains"

	evaluationRubricExactMatchVersion              = "exact-match-v1"
	evaluationRubricCaseInsensitiveContainsVersion = "case-insensitive-contains-v1"

	legacyEvaluationContainsRubric = "return a score of 1 only when the expected text is present."
)

type evaluationRubricContract struct {
	name    string
	version string
}

func normalizeEvaluationRubric(value string) (evaluationRubricContract, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "", evaluationRubricExactMatch, "exact-match", "exact match":
		return evaluationRubricContract{
			name:    evaluationRubricExactMatch,
			version: evaluationRubricExactMatchVersion,
		}, nil
	case evaluationRubricCaseInsensitiveContains,
		"case-insensitive-contains",
		"case-insensitive contains",
		legacyEvaluationContainsRubric:
		return evaluationRubricContract{
			name:    evaluationRubricCaseInsensitiveContains,
			version: evaluationRubricCaseInsensitiveContainsVersion,
		}, nil
	default:
		return evaluationRubricContract{}, fmt.Errorf(
			"unsupported evaluation rubric %q",
			strings.TrimSpace(value),
		)
	}
}

func normalizeEvaluationRubricOverride(
	value *string,
) (*string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	contract, err := normalizeEvaluationRubric(*value)
	if err != nil {
		return nil, err
	}
	return &contract.name, nil
}

func frozenEvaluationRubric(
	rubric string,
	version string,
) (evaluationRubricContract, error) {
	contract, err := normalizeEvaluationRubric(rubric)
	if err != nil {
		return evaluationRubricContract{}, err
	}
	if version != "" && version != contract.version {
		return evaluationRubricContract{}, fmt.Errorf(
			"evaluation rubric version %q does not match %q",
			version,
			contract.name,
		)
	}
	return contract, nil
}

func evaluateEvaluationRubric(
	rubric string,
	output string,
	expected string,
) (float64, string, error) {
	contract, err := normalizeEvaluationRubric(rubric)
	if err != nil {
		return 0, "", err
	}
	output = strings.TrimSpace(output)
	expected = strings.TrimSpace(expected)

	matched := false
	switch contract.name {
	case evaluationRubricExactMatch:
		matched = output == expected
	case evaluationRubricCaseInsensitiveContains:
		if expected == "" {
			matched = output == ""
		} else {
			matched = strings.Contains(
				strings.ToLower(output),
				strings.ToLower(expected),
			)
		}
	}
	if matched {
		return 1, contract.version, nil
	}
	return 0, contract.version, nil
}
