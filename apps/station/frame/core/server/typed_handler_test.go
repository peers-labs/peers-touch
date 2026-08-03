package server

import "testing"

func TestTypedHandlerQueryBindingUsesSnakeCaseJSONFields(t *testing.T) {
	type request struct {
		ConversationID string `json:"conversation_id" query:"conversation_id"`
		AfterSeq       int64  `json:"after_seq,string" query:"after_seq"`
		Limit          int    `json:"limit,string" query:"limit"`
	}

	queryJSON, ok := queryParamsToJSON(
		"/conversation/messages?conversation_id=direct-1&after_seq=7&limit=20",
	)
	if !ok {
		t.Fatal("queryParamsToJSON did not recognize valid query parameters")
	}

	var got request
	if err := (&ProtoJSONSerializer{}).Unmarshal(queryJSON, &got); err != nil {
		t.Fatalf("query unmarshal failed: %v", err)
	}
	if got.ConversationID != "direct-1" || got.AfterSeq != 7 || got.Limit != 20 {
		t.Fatalf("unexpected bound request: %+v", got)
	}
}
