package bootstrap

import (
	"fmt"
	"reflect"
	"strings"
)

type joinable interface {
	String() string
}

func joinForPrintLineByLine(sep string, in interface{}) string {
	val := reflect.ValueOf(in)
	if val.Kind() != reflect.Slice && val.Kind() != reflect.Array {
		return ""
	}

	var str []string
	for i := 0; i < val.Len(); i++ {
		elem := val.Index(i).Interface()
		if j, ok := elem.(joinable); ok {
			str = append(str, j.String())
		}
	}

	return strings.Join(str, fmt.Sprintf(`%s
`, sep))
}
