// Package provisioning implements the "scan to create a bot" onboarding path.
//
// It drives Feishu's consumer QR login (www.feishu.cn/accounts/qrlogin) to
// obtain a short-lived developer-console session, then uses that human
// session against the developer console (open.feishu.cn/developers/v1) to
// create a self-built application, enable the bot ability, subscribe to the
// private-message event over a long connection, import the minimum scopes and
// publish a version. None of these are public OpenAPI endpoints; the package
// is a deliberately small port of the reference product's websimulate flow,
// reduced to private-chat text messaging.
//
// The app secret returned by the console is held only in memory for the
// short setup session. It is never persisted here: the caller (channel
// subserver) seals it into the fp-00 vault only when the user confirms and
// enables the binding in Desktop.
package provisioning

import (
	"context"
	"time"
)

const (
	defaultWWWBase        = "https://www.feishu.cn"
	defaultFeishuOpenBase = "https://open.feishu.cn"
	defaultLarkOpenBase   = "https://open.larkoffice.com"
	defaultFeishuWSBase   = "https://open.feishu.cn"
	defaultLarkWSBase     = "https://open.larksuite.com"
	developerAPIPath      = "/developers/v1"
	csrfPagePath          = "/app?lang=zh-CN"

	// QR session lifetime while waiting for a scan/confirm.
	qrSessionTTL = 5 * time.Minute
	// Completed session (credentials held) lifetime awaiting user confirm.
	completedSessionTTL = 5 * time.Minute
)

// Config holds overridable endpoints (tests inject a fake server).
type Config struct {
	WWWBase  string // consumer login host
	OpenBase string // developer console host
	WSBase   string // public OpenAPI host used by the temporary long connection
	// AppName is the created application name when the caller omits one.
	DefaultAppName string

	// wsEstablish opens the short-lived long connection required while the
	// console switches the app to WebSocket callback mode. Defaults to the
	// official Lark SDK client. Unexported test seam.
	wsEstablish func(ctx context.Context, appID, appSecret string) (func(), error)
	// consoleSleep waits for developer-console eventual consistency.
	// Defaults to time.Sleep. Unexported test seam.
	consoleSleep func(time.Duration)
}

// PollStatus is the terminal/transient state of one QR setup session.
type PollStatus string

const (
	StatusPending        PollStatus = "pending"         // QR shown, waiting for scan
	StatusScanned        PollStatus = "scanned"         // scanned on phone, awaiting confirm
	StatusProcessing     PollStatus = "processing"      // creating the app
	StatusSuccess        PollStatus = "success"         // app created and online; ready to confirm
	StatusReviewRequired PollStatus = "review_required" // created but tenant admin must approve the release
	StatusError          PollStatus = "error"
	StatusExpired        PollStatus = "expired"
	StatusNotFound       PollStatus = "not_found"
)

// QRStart is returned when a setup session begins.
type QRStart struct {
	SessionID string
	// QRPayload is the qrlogin token envelope rendered as a QR code by the
	// client: {"qrlogin":{"token":"..."}}.
	QRPayload string
	ExpiresIn time.Duration
}

// BotSummary is the non-secret projection of a created app.
type BotSummary struct {
	AppID               string
	AppName             string
	AvatarURL           string
	ConsoleURL          string
	OwnerProviderUserID string
	// PublishedOnline is false when the release is pending tenant review.
	PublishedOnline bool
}

// PollResult is one poll observation. On success the secret is retained
// server-side and retrieved later via Confirm/ConsumeCredential.
type PollResult struct {
	Status     PollStatus
	Bot        *BotSummary
	ConsoleURL string
	Error      string
}

// Credential is the sealed-ready application credential handed to the channel
// binding flow exactly once when the user confirms.
type Credential struct {
	AppID     string
	AppSecret string
}
