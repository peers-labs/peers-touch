package model

import "github.com/cloudwego/hertz/pkg/app"

// Endpoint 定义API端点结构
type Endpoint struct {
	Method  string
	Path    string
	Handler app.HandlerFunc
}

// FailedResponse 定义失败响应结构
type FailedResponse struct {
	Code    StatusCode `json:"code"`
	Message string     `json:"message"`
	Error   *Error     `json:"error,omitempty"`
}

// NewFailedResponse 创建失败响应
func NewFailedResponse(code StatusCode, message string, err *Error) *FailedResponse {
	return &FailedResponse{
		Code:    code,
		Message: message,
		Error:   err,
	}
}