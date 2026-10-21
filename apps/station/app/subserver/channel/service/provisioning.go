package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/provisioning"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type provisioningManager interface {
	Start(context.Context, string, string, string) (*provisioning.QRStart, error)
	Poll(context.Context, string) *provisioning.PollResult
	SnapshotCredential(string) (provisioning.Credential, *provisioning.BotSummary, bool)
	CommitCredential(string)
	Cancel(string) bool
}

type ProvisioningStepView struct {
	ID     string
	Label  string
	Status string
	Detail string
}

type ProvisioningView struct {
	JobID          string
	SessionID      string
	Status         string
	Bot            *provisioning.BotSummary
	ConsoleURL     string
	ErrorMessage   string
	RecoveryAction string
	Steps          []ProvisioningStepView
}

type ProvisioningCoordinator struct {
	db       *gorm.DB
	manager  provisioningManager
	secrets  *secret.Service
	bindings *BindingService
	runtime  *RuntimeHost
	now      func() time.Time
}

func NewProvisioningCoordinator(
	db *gorm.DB,
	manager provisioningManager,
	secrets *secret.Service,
	bindings *BindingService,
	runtime *RuntimeHost,
) *ProvisioningCoordinator {
	return &ProvisioningCoordinator{
		db: db, manager: manager, secrets: secrets,
		bindings: bindings, runtime: runtime,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (c *ProvisioningCoordinator) Start(
	ctx context.Context,
	actorPTID, appName, description, region string,
) (*provisioning.QRStart, string, error) {
	actorPTID = strings.TrimSpace(actorPTID)
	if actorPTID == "" {
		return nil, "", fmt.Errorf("%w: actor is required", ErrInvalidBinding)
	}
	appName = strings.TrimSpace(appName)
	if appName == "" {
		appName = "Peers Lark Assistant"
	}
	region = normalizedRegion(region, "")
	start, err := c.manager.Start(ctx, appName, description, region)
	if err != nil {
		return nil, "", err
	}
	now := c.now()
	job := persistence.ChannelProvisioningJob{
		ID: newBindingID(), ActorPTID: actorPTID, SessionID: start.SessionID,
		Region: region, AppName: appName,
		AppDescription: strings.TrimSpace(description),
		Status:         "wait_scan", Step: "scan", ExpiresAt: now.Add(24 * time.Hour),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := c.db.WithContext(ctx).Create(&job).Error; err != nil {
		c.manager.Cancel(start.SessionID)
		return nil, "", fmt.Errorf("create provisioning job: %w", err)
	}
	return start, job.ID, nil
}

func (c *ProvisioningCoordinator) Poll(
	ctx context.Context,
	actorPTID, jobID, sessionID string,
) (ProvisioningView, error) {
	job, err := c.loadJob(ctx, actorPTID, jobID, sessionID)
	if err != nil {
		return ProvisioningView{}, err
	}
	if job.Status == "committed" || job.Status == "cancelled" {
		return c.jobView(job, nil), nil
	}
	if c.now().After(job.ExpiresAt) {
		_ = c.updateJob(ctx, job.ID, map[string]any{
			"status": "expired", "step": "expired", "updated_at": c.now(),
		})
		job.Status = "expired"
		job.Step = "expired"
		return c.jobView(job, nil), nil
	}
	result := c.manager.Poll(ctx, job.SessionID)
	if result.Status == provisioning.StatusNotFound {
		if job.CredentialSecretID != "" {
			return c.jobView(job, nil), nil
		}
		job.Status = "reauth_required"
		job.Step = "scan"
		job.ErrorMessage = "The login session ended. Scan again to continue the same setup."
		_ = c.updateJob(ctx, job.ID, map[string]any{
			"status": job.Status, "step": job.Step,
			"error_message": job.ErrorMessage, "updated_at": c.now(),
		})
		return c.jobView(job, nil), nil
	}
	updates := map[string]any{"updated_at": c.now()}
	switch result.Status {
	case provisioning.StatusPending:
		updates["status"], updates["step"] = "wait_scan", "scan"
	case provisioning.StatusScanned:
		updates["status"], updates["step"] = "phone_confirm", "confirm_identity"
	case provisioning.StatusProcessing:
		updates["status"], updates["step"] = "provisioning", "create_app"
	case provisioning.StatusSuccess:
		updates["status"], updates["step"] = "ready", "ready"
	case provisioning.StatusReviewRequired:
		updates["status"], updates["step"] = "wait_admin", "publish"
	case provisioning.StatusExpired:
		updates["status"], updates["step"] = "reauth_required", "scan"
	case provisioning.StatusError:
		updates["status"], updates["step"] = "failed", "failed"
		updates["error_message"] = redactDiagnostic(result.Error)
	}
	if result.Bot != nil {
		updates["provider_app_id"] = result.Bot.AppID
		updates["owner_provider_user_id"] = result.Bot.OwnerProviderUserID
		updates["console_url"] = result.Bot.ConsoleURL
		job.ProviderAppID = result.Bot.AppID
		job.OwnerProviderUserID = result.Bot.OwnerProviderUserID
		job.ConsoleURL = result.Bot.ConsoleURL
	}
	if credential, _, ok := c.manager.SnapshotCredential(job.SessionID); ok &&
		job.CredentialSecretID == "" {
		expires := job.ExpiresAt
		secretID, sealErr := c.secrets.Put(ctx, secret.PutInput{
			ActorPTID: job.ActorPTID, Purpose: secret.PurposeChannel,
			Name:      "provisioning:" + job.ID,
			Plaintext: encodeCredentialPayload(credential.AppID, credential.AppSecret),
			ExpiresAt: &expires,
		})
		if sealErr != nil {
			return ProvisioningView{}, fmt.Errorf("seal provisioning credential: %w", sealErr)
		}
		updates["credential_secret_id"] = secretID
		job.CredentialSecretID = secretID
	}
	if err := c.updateJob(ctx, job.ID, updates); err != nil {
		return ProvisioningView{}, err
	}
	if value, ok := updates["status"].(string); ok {
		job.Status = value
	}
	if value, ok := updates["step"].(string); ok {
		job.Step = value
	}
	if value, ok := updates["error_message"].(string); ok {
		job.ErrorMessage = value
	}
	return c.jobView(job, result.Bot), nil
}

func (c *ProvisioningCoordinator) Confirm(
	ctx context.Context,
	actorPTID, jobID, sessionID string,
	input CreateBindingInput,
) (BindingView, bool, error) {
	job, err := c.loadJob(ctx, actorPTID, jobID, sessionID)
	if err != nil {
		return BindingView{}, false, err
	}
	if job.BindingID != "" {
		view, err := c.bindings.Get(ctx, actorPTID, job.BindingID)
		return view, true, err
	}
	if job.Status != "ready" || job.CredentialSecretID == "" {
		return BindingView{}, false, fmt.Errorf("%w: provisioning job is not ready", ErrInvalidBinding)
	}
	reservation := randomToken(16)
	reservationExpiry := c.now().Add(2 * time.Minute)
	result := c.db.WithContext(ctx).Model(&persistence.ChannelProvisioningJob{}).
		Where(
			"id = ? AND actor_ptid = ? AND binding_id = '' AND status = ? "+
				"AND (reservation_token = '' OR reservation_expires < ?)",
			job.ID, actorPTID, "ready", c.now(),
		).
		Updates(map[string]any{
			"reservation_token":   reservation,
			"reservation_expires": reservationExpiry,
			"updated_at":          c.now(),
		})
	if result.Error != nil {
		return BindingView{}, false, result.Error
	}
	if result.RowsAffected != 1 {
		reloaded, loadErr := c.loadJob(ctx, actorPTID, jobID, sessionID)
		if loadErr == nil && reloaded.BindingID != "" {
			view, getErr := c.bindings.Get(ctx, actorPTID, reloaded.BindingID)
			return view, true, getErr
		}
		return BindingView{}, false, fmt.Errorf("%w: provisioning confirmation is in progress", ErrInvalidBinding)
	}
	release := func() {
		_ = c.db.WithContext(context.WithoutCancel(ctx)).
			Model(&persistence.ChannelProvisioningJob{}).
			Where("id = ? AND reservation_token = ?", job.ID, reservation).
			Updates(map[string]any{
				"reservation_token": "", "reservation_expires": nil,
				"updated_at": c.now(),
			}).Error
	}
	raw, err := c.secrets.Get(
		ctx, actorPTID, secret.PurposeChannel, job.CredentialSecretID,
	)
	if err != nil {
		release()
		return BindingView{}, false, err
	}
	var credential CredentialPayload
	if err := json.Unmarshal(raw, &credential); err != nil {
		release()
		return BindingView{}, false, err
	}
	input.ActorPTID = actorPTID
	input.ProviderAppID = credential.AppID
	input.AppSecret = credential.AppSecret
	input.Region = job.Region
	input.AppMode = "managed"
	input.OwnerProviderUserID = job.OwnerProviderUserID
	if strings.TrimSpace(input.Name) == "" {
		input.Name = job.AppName
	}
	view, err := c.bindings.Create(ctx, input)
	if err != nil {
		release()
		return BindingView{}, false, err
	}
	now := c.now()
	err = c.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var locked persistence.ChannelProvisioningJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND reservation_token = ?", job.ID, reservation).
			First(&locked).Error; err != nil {
			return err
		}
		return tx.Model(&locked).Updates(map[string]any{
			"binding_id": view.ID, "status": "committed", "step": "complete",
			"reservation_token": "", "reservation_expires": nil,
			"updated_at": now,
		}).Error
	})
	if err != nil {
		release()
		return BindingView{}, false, err
	}
	c.manager.CommitCredential(job.SessionID)
	_ = c.secrets.Delete(
		context.WithoutCancel(ctx), actorPTID,
		secret.PurposeChannel, job.CredentialSecretID,
	)
	if view.Enabled && c.runtime != nil {
		if startErr := c.runtime.StartBinding(ctx, view.ID); startErr != nil {
			_ = c.bindings.SetConnectionState(
				context.WithoutCancel(ctx), view.ID,
				BindingStateFailed, startErr.Error(),
			)
			view, _ = c.bindings.Get(ctx, actorPTID, view.ID)
		}
	}
	return view, false, nil
}

func (c *ProvisioningCoordinator) Cancel(
	ctx context.Context,
	actorPTID, jobID, sessionID string,
) error {
	job, err := c.loadJob(ctx, actorPTID, jobID, sessionID)
	if err != nil {
		return err
	}
	if job.BindingID != "" {
		return fmt.Errorf("%w: committed provisioning cannot be cancelled", ErrInvalidBinding)
	}
	c.manager.Cancel(job.SessionID)
	if job.CredentialSecretID != "" {
		_ = c.secrets.Delete(
			ctx, actorPTID, secret.PurposeChannel, job.CredentialSecretID,
		)
	}
	return c.updateJob(ctx, job.ID, map[string]any{
		"status": "cancelled", "step": "cancelled",
		"credential_secret_id": "", "updated_at": c.now(),
	})
}

func (c *ProvisioningCoordinator) loadJob(
	ctx context.Context,
	actorPTID, jobID, sessionID string,
) (*persistence.ChannelProvisioningJob, error) {
	var job persistence.ChannelProvisioningJob
	query := c.db.WithContext(ctx).Where("actor_ptid = ?", strings.TrimSpace(actorPTID))
	if strings.TrimSpace(jobID) != "" {
		query = query.Where("id = ?", strings.TrimSpace(jobID))
	} else {
		query = query.Where("session_id = ?", strings.TrimSpace(sessionID))
	}
	err := query.First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBindingNotFound
	}
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (c *ProvisioningCoordinator) updateJob(
	ctx context.Context,
	jobID string,
	updates map[string]any,
) error {
	return c.db.WithContext(ctx).Model(&persistence.ChannelProvisioningJob{}).
		Where("id = ?", jobID).Updates(updates).Error
}

func (c *ProvisioningCoordinator) jobView(
	job *persistence.ChannelProvisioningJob,
	bot *provisioning.BotSummary,
) ProvisioningView {
	view := ProvisioningView{
		JobID: job.ID, SessionID: job.SessionID, Status: job.Status,
		Bot: bot, ConsoleURL: job.ConsoleURL, ErrorMessage: job.ErrorMessage,
		Steps: provisioningSteps(job.Step, job.Status),
	}
	if view.Bot == nil && job.ProviderAppID != "" {
		view.Bot = &provisioning.BotSummary{
			AppID: job.ProviderAppID, AppName: job.AppName,
			ConsoleURL:          job.ConsoleURL,
			OwnerProviderUserID: job.OwnerProviderUserID,
			PublishedOnline: job.Status == "ready" ||
				job.Status == "committed",
		}
	}
	switch job.Status {
	case "wait_admin":
		view.RecoveryAction = "Approve the release in Lark Developer Console, then check again."
	case "reauth_required":
		view.RecoveryAction = "Scan again to resume this setup."
	case "failed":
		view.RecoveryAction = "Retry the failed step or use the existing app flow."
	}
	return view
}

func provisioningSteps(current, status string) []ProvisioningStepView {
	definitions := []struct{ id, label string }{
		{"scan", "Confirm identity"},
		{"create_app", "Create app identity"},
		{"permissions", "Enable messaging and permissions"},
		{"publish", "Publish app"},
		{"ready", "Connect Agent"},
	}
	result := make([]ProvisioningStepView, 0, len(definitions))
	currentIndex := len(definitions)
	for index, definition := range definitions {
		if definition.id == current {
			currentIndex = index
			break
		}
	}
	for index, definition := range definitions {
		stepStatus := "pending"
		if index < currentIndex {
			stepStatus = "complete"
		} else if index == currentIndex {
			stepStatus = "active"
		}
		if status == "wait_admin" && definition.id == "publish" {
			stepStatus = "waiting"
		}
		if status == "failed" && index == currentIndex {
			stepStatus = "failed"
		}
		if status == "committed" {
			stepStatus = "complete"
		}
		result = append(result, ProvisioningStepView{
			ID: definition.id, Label: definition.label, Status: stepStatus,
		})
	}
	return result
}
