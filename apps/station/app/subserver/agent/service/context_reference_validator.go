package service

import (
	"regexp"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
)

type retiredInlineContextReference struct {
	kind  string
	token string
	start int
}

type retiredInlineContextReferencePattern struct {
	kind    string
	pattern *regexp.Regexp
}

var retiredInlineContextReferencePatterns = []retiredInlineContextReferencePattern{
	{kind: "file", pattern: regexp.MustCompile(`@file:\S*`)},
	{kind: "folder", pattern: regexp.MustCompile(`@folder:\S*`)},
	{kind: "url", pattern: regexp.MustCompile(`@url:\S*`)},
	{kind: "diff", pattern: regexp.MustCompile(`@diff\b`)},
	{kind: "staged", pattern: regexp.MustCompile(`@staged\b`)},
	{kind: "git", pattern: regexp.MustCompile(`@git:\S*`)},
}

func validateNoRetiredInlineContextReference(userInput string) error {
	reference, found := firstRetiredInlineContextReference(userInput)
	if !found {
		return nil
	}

	return errcode.NewContextInvalidReference(reference.kind, reference.token)
}

func firstRetiredInlineContextReference(
	userInput string,
) (retiredInlineContextReference, bool) {
	first := retiredInlineContextReference{start: -1}
	for _, candidate := range retiredInlineContextReferencePatterns {
		location := candidate.pattern.FindStringIndex(userInput)
		if location == nil || (first.start >= 0 && location[0] >= first.start) {
			continue
		}
		first = retiredInlineContextReference{
			kind:  candidate.kind,
			token: userInput[location[0]:location[1]],
			start: location[0],
		}
	}

	return first, first.start >= 0
}
