package native

import (
	"context"
	"reflect"
	"testing"
)

func TestGormLoggerOmitsBoundParameters(t *testing.T) {
	query := "INSERT INTO messaging_attachment_upload_parts (storage_key) VALUES (?)"
	filtered, parameters := NewGormLogger().(interface {
		ParamsFilter(context.Context, string, ...interface{}) (string, []interface{})
	}).ParamsFilter(context.Background(), query, "private/storage/key")

	if filtered != query {
		t.Fatalf("filtered query = %q, want %q", filtered, query)
	}
	if !reflect.DeepEqual(parameters, []interface{}(nil)) {
		t.Fatalf("filtered parameters = %#v, want nil", parameters)
	}
}
