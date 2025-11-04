package types

type PageQuery struct {
	Page int32 `json:"page"`
	Size int32 `json:"size"`
}

type PageData struct {
	Total int32         `json:"total"`
	List  []interface{} `json:"list"`
}
