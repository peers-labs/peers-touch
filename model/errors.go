package model

import "errors"

var (
	ErrWellKnownInvalidResourceFormat = errors.New("invalid resource format, should be <type>:<value>, e.g. acct:$EMAIL")
	ErrWellKnownUnsupportedPrefixType = errors.New("unsupported type, only acct is supported")
)
