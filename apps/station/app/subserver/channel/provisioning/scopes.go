package provisioning

const (
	scopeIdentityApp  = "2"
	scopeIdentityUser = "1"
)

type developerScope struct {
	ID   string
	App  bool
	User bool
}

// scopeSeed is numeric scope metadata observed on the CN developer console.
// The console varies numeric ids across tenants, so /scope/all is consulted
// live to refresh them; the seed (a) keeps provisioning working when that
// endpoint is unavailable and (b) identifies the app/user scope identity
// authoritatively.
type scopeSeed struct {
	id   string
	app  bool
	user bool
}

var embeddedScopes = map[string]scopeSeed{
	"im:message":                  {"20001", true, true},
	"im:message:send_as_bot":      {"1000", true, false},
	"im:message.p2p_msg:readonly": {"3000", true, false},
	"im:chat:read":                {"1014181", true, true},
	"im:chat:create":              {"1014178", true, false},
	"contact:user.id:readonly":    {"8", true, true},
}

// collectScopes walks the developer console scope tree and maps scope names
// to numeric ids with their app/user identity.
func collectScopes(value any, out map[string]developerScope) {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			collectScopes(item, out)
		}
	case map[string]any:
		name := firstString(v, "name", "scopeName", "scope_name", "scope")
		id := firstString(v, "id", "scopeID", "scopeId", "scope_id")
		if name != "" && id != "" {
			s := developerScope{ID: id}
			if byLevel, ok := v["scopeType2ScopeLevel"].(map[string]any); ok {
				if len(intSlice(byLevel[scopeIdentityApp])) > 0 {
					s.App = true
				}
				if len(intSlice(byLevel[scopeIdentityUser])) > 0 {
					s.User = true
				}
			}
			if !s.App && !s.User {
				// Default to app scope when identity metadata is absent.
				s.App = true
			}
			out[name] = s
		}
		for _, item := range v {
			collectScopes(item, out)
		}
	}
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if s := asString(m[k]); s != "" {
			return s
		}
	}
	return ""
}

func intSlice(v any) []int {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]int, 0, len(items))
	for _, it := range items {
		if n, ok := it.(float64); ok {
			out = append(out, int(n))
		}
	}
	return out
}
