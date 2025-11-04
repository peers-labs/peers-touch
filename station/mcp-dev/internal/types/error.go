package types

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error *ErrorData `json:"error"`
}

// ErrorData represents error data
type ErrorData struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}