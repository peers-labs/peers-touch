package model

import (
	"fmt"
)

var (
	ErrUndefined = NewError("t00000", "undefined")

	ErrWellKnownInvalidResourceFormat = NewError("t10001", "invalid resource format, should be <type>:<value>, e.g. acct:$EMAIL")
	ErrWellKnownUnsupportedPrefixType = NewError("t10002", "unsupported type, only acct is supported")
	ErrActorInvalidName               = NewError("t10003", "signup with an invalid name")
	ErrActorInvalidEmail              = NewError("t10004", "signup with an invalid email")
	ErrActorInvalidPassword           = NewError("t10005", "signup with an invalid password")
	ErrActorActorExists               = NewError("t10006", "signup with an existing actor")
	ErrActorInvalidPassport           = NewError("t10007", "signup with an invalid passport")
	ErrActorNotFound                  = NewError("t10008", "actor not found")
	ErrActorInvalidCredentials        = NewError("t10009", "invalid email or password")
	ErrPeerAddrExists                 = NewError("t10010", "peer address already exists")
)

type Error struct {
	error

	// Code is the error code, for Touch native, it starts with t and followed by a number, e.g. t10001.
	// For third-party, just make it follow your own convention and protocol.
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	}

	return e.Message
}

func (e *Error) ReplaceMsg(msg string) *Error {
	e.Message = msg
	return e
}

func NewError(code, message string) *Error {
	return &Error{
		Code:    code,
		Message: message,
	}
}

func UndefinedError(err error) *Error {
	return NewError("t00000", err.Error())
}
