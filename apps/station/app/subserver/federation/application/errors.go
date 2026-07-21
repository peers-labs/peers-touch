package application

import "errors"

var (
	ErrPolicyNotSupported = errors.New("policy type not supported")
	ErrFederationNotFound = errors.New("federation not found")
)
