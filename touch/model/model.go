package model

const (
	SuccessCode = "200"
)

type Params interface {
	Check() error
}

type StatusCode = string

type SuccessResponse struct {
	Code StatusCode  `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"data"`
}

func NewSuccessResponse(msg string, data interface{}) *SuccessResponse {
	return &SuccessResponse{
		Code: SuccessCode,
		Msg:  msg,
		Data: data,
	}
}

type PageData[T any] struct {
	Total int `json:"total"`
	Num   int `json:"num"`
	List  []T `json:"list"`
}
