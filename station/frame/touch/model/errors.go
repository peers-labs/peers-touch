package model

import (
	"fmt"
)

var errorMessages = map[ErrorCode]string{
	ErrorCode_ERROR_CODE_UNDEFINED: "undefined error",

	ErrorCode_ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT: "invalid resource format, should be <type>:<value>, e.g. acct:$EMAIL",
	ErrorCode_ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE: "unsupported type, only acct is supported",
	ErrorCode_ERROR_CODE_ACTOR_INVALID_NAME:                 "invalid name",
	ErrorCode_ERROR_CODE_ACTOR_INVALID_EMAIL:                "invalid email",
	ErrorCode_ERROR_CODE_ACTOR_INVALID_PASSWORD:             "invalid password",
	ErrorCode_ERROR_CODE_ACTOR_EXISTS:                       "actor already exists",
	ErrorCode_ERROR_CODE_ACTOR_INVALID_PASSPORT:             "invalid passport",
	ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND:                    "actor not found",
	ErrorCode_ERROR_CODE_ACTOR_INVALID_CREDENTIALS:          "invalid email or password",
	ErrorCode_ERROR_CODE_PEER_ADDR_EXISTS:                   "peer address already exists",

	ErrorCode_ERROR_CODE_UNAUTHORIZED:             "unauthorized",
	ErrorCode_ERROR_CODE_INVALID_REQUEST:          "invalid request",
	ErrorCode_ERROR_CODE_INVALID_QUERY_PARAMETERS: "invalid query parameters",
	ErrorCode_ERROR_CODE_INVALID_REQUEST_BODY:     "invalid request body",
	ErrorCode_ERROR_CODE_INVALID_PROTOBUF:         "invalid protobuf",
	ErrorCode_ERROR_CODE_FAILED_TO_READ_BODY:      "failed to read body",
	ErrorCode_ERROR_CODE_METHOD_NOT_ALLOWED:       "method not allowed",
	ErrorCode_ERROR_CODE_INTERNAL_SERVER_ERROR:    "internal server error",

	ErrorCode_ERROR_CODE_POST_ID_REQUIRED:    "post_id is required",
	ErrorCode_ERROR_CODE_POST_NOT_FOUND:      "post not found",
	ErrorCode_ERROR_CODE_USER_ID_REQUIRED:    "user_id is required",
	ErrorCode_ERROR_CODE_CREATE_POST_FAILED:  "failed to create post",
	ErrorCode_ERROR_CODE_UPDATE_POST_FAILED:  "failed to update post",
	ErrorCode_ERROR_CODE_DELETE_POST_FAILED:  "failed to delete post",
	ErrorCode_ERROR_CODE_LIKE_POST_FAILED:    "failed to like post",
	ErrorCode_ERROR_CODE_UNLIKE_POST_FAILED:  "failed to unlike post",
	ErrorCode_ERROR_CODE_GET_POST_FAILED:     "failed to get post",
	ErrorCode_ERROR_CODE_LIST_POSTS_FAILED:   "failed to list posts",
	ErrorCode_ERROR_CODE_REPOST_FAILED:       "failed to repost",
	ErrorCode_ERROR_CODE_GET_LIKERS_FAILED:   "failed to get likers",
	ErrorCode_ERROR_CODE_GET_TIMELINE_FAILED: "failed to get timeline",
}

func NewErrorResponse(code ErrorCode, customMessage ...string) *ErrorResponse {
	message := errorMessages[code]
	if len(customMessage) > 0 && customMessage[0] != "" {
		message = customMessage[0]
	}
	return &ErrorResponse{
		Code:    code,
		Message: message,
	}
}

func (e *ErrorResponse) Error() string {
	return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}

func (e *ErrorResponse) ReplaceMsg(msg string) *ErrorResponse {
	return &ErrorResponse{
		Code:    e.Code,
		Message: msg,
		Details: e.Details,
	}
}

func UndefinedError(err error) *ErrorResponse {
	return NewErrorResponse(ErrorCode_ERROR_CODE_UNDEFINED, err.Error())
}

var (
	ErrWellKnownInvalidResourceFormat = NewErrorResponse(ErrorCode_ERROR_CODE_WELL_KNOWN_INVALID_RESOURCE_FORMAT)
	ErrWellKnownUnsupportedPrefixType = NewErrorResponse(ErrorCode_ERROR_CODE_WELL_KNOWN_UNSUPPORTED_PREFIX_TYPE)
	ErrActorInvalidName               = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_INVALID_NAME)
	ErrActorInvalidEmail              = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_INVALID_EMAIL)
	ErrActorInvalidPassword           = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_INVALID_PASSWORD)
	ErrActorExists                    = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_EXISTS)
	ErrActorInvalidPassport           = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_INVALID_PASSPORT)
	ErrActorNotFound                  = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_NOT_FOUND)
	ErrActorInvalidCredentials        = NewErrorResponse(ErrorCode_ERROR_CODE_ACTOR_INVALID_CREDENTIALS)
	ErrPeerAddrExists                 = NewErrorResponse(ErrorCode_ERROR_CODE_PEER_ADDR_EXISTS)
)

func NewError(code string, message string) *ErrorResponse {
	return &ErrorResponse{
		Code:    ErrorCode_ERROR_CODE_UNDEFINED,
		Message: fmt.Sprintf("[%s] %s", code, message),
	}
}
