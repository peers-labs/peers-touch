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

type WebFingerParams struct {
	Params
	Resource           WebFingerResource `query:"resource"`
	ActivityPubVersion string            `query:"activity_pub_version"`
}

func (r WebFingerParams) Check() error {
	if strings.TrimSpace(string(r.Resource)) == "" || strings.Contains(string(r.Resource), ":") == false {
		return ErrWellKnownInvalidResourceFormat
	}

	if r.Resource.Prefix() != "acct" {
		return ErrWellKnownUnsupportedPrefixType
	}

	return nil
}
