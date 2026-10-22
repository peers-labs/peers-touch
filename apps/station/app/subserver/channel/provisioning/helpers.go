package provisioning

import "encoding/json"

func respCode(r map[string]any) int {
	if r == nil {
		return -1
	}
	switch v := r["code"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	default:
		return -1
	}
}

func respData(r map[string]any) map[string]any {
	if r == nil {
		return nil
	}
	m, _ := r["data"].(map[string]any)
	return m
}

func respString(r map[string]any, keys ...string) string {
	cur := r
	for i, k := range keys {
		if cur == nil {
			return ""
		}
		if i == len(keys)-1 {
			return asString(cur[k])
		}
		cur, _ = cur[k].(map[string]any)
	}
	return ""
}

func respSummary(r map[string]any) string {
	if r == nil {
		return "code=-1 msg=\"\""
	}
	msg, _ := r["msg"].(string)
	if msg == "" {
		msg, _ = r["message"].(string)
	}
	return "code=" + itoa(respCode(r)) + " msg=" + quote(msg)
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return itoa(int(t))
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func asMapSlice(v any) []map[string]any {
	items, _ := v.([]any)
	out := make([]map[string]any, 0, len(items))
	for _, it := range items {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func mapBool(data map[string]any, keys ...string) bool {
	for _, k := range keys {
		switch v := data[k].(type) {
		case bool:
			if v {
				return true
			}
		}
	}
	return false
}

func unique(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	out := items[:0]
	for _, it := range items {
		if it == "" {
			continue
		}
		if _, ok := seen[it]; ok {
			continue
		}
		seen[it] = struct{}{}
		out = append(out, it)
	}
	return out
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
