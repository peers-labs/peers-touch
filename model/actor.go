package model

import (
	"strings"
)

type WebFingerResource string

func (r WebFingerResource) Prefix() string {
	return strings.Split(string(r), ":")[0]
}

func (r WebFingerResource) Value() string {
	return strings.Split(string(r), ":")[1]
}

func (r WebFingerResource) Check() error {
	if strings.TrimSpace(string(r)) == "" || strings.Contains(string(r), ":") == false {
		return ErrWellKnownInvalidResourceFormat
	}

	if r.Prefix() != "acct" {
		return ErrWellKnownUnsupportedPrefixType
	}

	return nil
}

type WebFingerParams struct {
	Resource           WebFingerResource `query:"resource"`
	ActivityPubVersion string            `query:"activity_pub_version"`
}
