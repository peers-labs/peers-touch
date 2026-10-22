// Package service hosts the channel-host application services.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/peers-labs/peers-touch/station/app/subserver/channel/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginpkg"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/pluginruntime"
)

// Lifecycle states.
const (
	StateRegistered = "registered" // installed, disabled
	StateActive     = "active"     // process up and handshake OK
	StateFailed     = "failed"     // enabled but process/handshake failing
	StateDisabled   = "disabled"   // explicitly stopped
)

// Errors.
var (
	ErrPluginNotFound = errors.New("channel plugin not found")
	ErrAlreadyEnabled = errors.New("channel plugin already enabled")
	ErrNotEnabled     = errors.New("channel plugin is not enabled")
)

// PluginView is the non-sensitive projection of a registered plugin.
type PluginView struct {
	ID           string
	Name         string
	Version      string
	ProviderKind string
	Description  string
	Enabled      bool
	Lifecycle    string
	HealthMsg    string
	Capabilities []string
	InstalledAt  time.Time
	LastStartAt  *time.Time
}

// Catalog owns plugin registration records and supervised processes.
type Catalog struct {
	db        *gorm.DB
	installer *pluginpkg.Installer
	handshake time.Duration

	mu      sync.Mutex
	running map[string]*pluginruntime.State

	// hostMethods are attached to every freshly started process so plugin
	// -> host RPCs (inboundEvent/connectionStatus/getCredential) work after
	// an automatic restart without re-registration races.
	hostMethods   map[string]pluginruntime.HostMethodHandler
	crashObserver func(pluginID string)
}

func NewCatalog(db *gorm.DB, installer *pluginpkg.Installer) *Catalog {
	return &Catalog{
		db:          db,
		installer:   installer,
		handshake:   10 * time.Second,
		running:     map[string]*pluginruntime.State{},
		hostMethods: map[string]pluginruntime.HostMethodHandler{},
	}
}

// OnHostMethod registers the host answerer for a plugin-initiated method.
// It applies to the next Enable (and every restart after it).
func (c *Catalog) OnHostMethod(method string, handler pluginruntime.HostMethodHandler) {
	c.mu.Lock()
	c.hostMethods[method] = handler
	c.mu.Unlock()
}

// SetCrashObserver registers a callback invoked after an enabled plugin's
// process dies unexpectedly (state already marked failed).
func (c *Catalog) SetCrashObserver(observer func(pluginID string)) {
	c.mu.Lock()
	c.crashObserver = observer
	c.mu.Unlock()
}

// RunningState returns the live process handle for one plugin, or nil.
func (c *Catalog) RunningState(id string) *pluginruntime.State {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.running[id]
}

// ImportFromDirectory installs and registers a plugin from a local directory.
// It starts disabled; call Enable separately so a bad import never starts a process.
func (c *Catalog) ImportFromDirectory(ctx context.Context, src string) (PluginView, error) {
	pkg, err := c.installer.ImportDirectory(src)
	if err != nil {
		return PluginView{}, err
	}
	return c.register(ctx, pkg)
}

// ImportFromArchive installs and registers from a zip.
func (c *Catalog) ImportFromArchive(ctx context.Context, zipPath string) (PluginView, error) {
	pkg, err := c.installer.ImportArchive(zipPath)
	if err != nil {
		return PluginView{}, err
	}
	return c.register(ctx, pkg)
}

func (c *Catalog) register(_ context.Context, pkg *pluginpkg.InstalledPackage) (PluginView, error) {
	caps, _ := json.Marshal(pkg.Manifest.Capabilities)
	now := time.Now().UTC()
	record := persistence.ChannelPlugin{
		ID:           pkg.Manifest.ID,
		Name:         pkg.Manifest.Name,
		Version:      pkg.Manifest.Version,
		ProviderKind: pkg.Manifest.ProviderKind,
		Description:  pkg.Manifest.Description,
		RootDir:      pkg.RootDir,
		ExecPath:     pkg.ExecPath,
		Capabilities: string(caps),
		ProtocolMin:  pkg.Manifest.Protocol.Min,
		ProtocolMax:  pkg.Manifest.Protocol.Max,
		Enabled:      false,
		Lifecycle:    StateRegistered,
		InstalledAt:  now,
		UpdatedAt:    now,
	}
	// Upsert: re-importing the same id/version updates registration.
	var existing persistence.ChannelPlugin
	err := c.db.Where("id = ?", record.ID).Take(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := c.db.Create(&record).Error; err != nil {
			return PluginView{}, fmt.Errorf("register plugin: %w", err)
		}
	case err != nil:
		return PluginView{}, fmt.Errorf("lookup plugin: %w", err)
	default:
		record.UpdatedAt = now
		if err := c.db.Save(&record).Error; err != nil {
			return PluginView{}, fmt.Errorf("update plugin registration: %w", err)
		}
	}
	return c.Get(record.ID)
}

// List returns all registered plugins.
func (c *Catalog) List(_ context.Context) ([]PluginView, error) {
	var records []persistence.ChannelPlugin
	if err := c.db.Order("installed_at DESC").Find(&records).Error; err != nil {
		return nil, err
	}
	views := make([]PluginView, 0, len(records))
	for _, r := range records {
		views = append(views, toView(r))
	}
	return views, nil
}

// Get returns one plugin.
func (c *Catalog) Get(id string) (PluginView, error) {
	r, err := c.load(id)
	if err != nil {
		return PluginView{}, err
	}
	return toView(*r), nil
}

// Enable spawns the plugin process, completes the initialize handshake, and
// marks it active. A failed handshake marks the record failed.
func (c *Catalog) Enable(ctx context.Context, id string) (PluginView, error) {
	record, err := c.load(id)
	if err != nil {
		return PluginView{}, err
	}

	c.mu.Lock()
	if _, ok := c.running[id]; ok {
		c.mu.Unlock()
		return PluginView{}, ErrAlreadyEnabled
	}
	c.mu.Unlock()

	hctx, cancel := context.WithTimeout(ctx, c.handshake)
	defer cancel()
	state, startErr := pluginruntime.Start(hctx, pluginruntime.ProcessConfig{
		ExecPath:         record.ExecPath,
		HandshakeTimeout: c.handshake,
	})
	if startErr != nil {
		_ = c.mark(id, false, StateFailed, startErr.Error(), nil)
		return PluginView{}, startErr
	}

	c.mu.Lock()
	for method, handler := range c.hostMethods {
		pluginID := id
		hostHandler := handler
		state.OnMethod(method, func(callCtx context.Context, params json.RawMessage) (any, error) {
			return hostHandler(
				pluginruntime.WithPluginIdentity(callCtx, pluginID),
				params,
			)
		})
	}
	c.running[id] = state
	c.mu.Unlock()

	now := time.Now().UTC()
	_ = c.mark(id, true, StateActive, "active", &now)
	c.watchExit(id, state)

	return c.Get(id)
}

// Disable stops the process and marks the record disabled.
func (c *Catalog) Disable(_ context.Context, id string) (PluginView, error) {
	c.mu.Lock()
	state, ok := c.running[id]
	delete(c.running, id)
	c.mu.Unlock()
	if !ok {
		// Idempotent: an enabled-but-not-running record (e.g. after restart)
		// can still be marked disabled.
		if err := c.mark(id, false, StateDisabled, "disabled", nil); err != nil {
			return PluginView{}, err
		}
		return c.Get(id)
	}
	if err := state.Stop(); err != nil {
		return PluginView{}, fmt.Errorf("stop plugin: %w", err)
	}
	exitAt := time.Now().UTC()
	if err := c.mark(id, false, StateDisabled, "disabled", nil, exitAt); err != nil {
		return PluginView{}, err
	}
	return c.Get(id)
}

// Delete stops the process when enabled, removes the on-disk package, then the record.
func (c *Catalog) Delete(ctx context.Context, id string) error {
	if _, err := c.Disable(ctx, id); err != nil {
		return err
	}
	record, err := c.load(id)
	if err != nil {
		return err
	}
	if err := c.installer.Remove(record.ID, record.Version); err != nil {
		return err
	}
	if err := c.db.Where("id = ?", id).Delete(&persistence.ChannelPlugin{}).Error; err != nil {
		return fmt.Errorf("delete registration: %w", err)
	}
	return nil
}

// RecoverActive restarts plugins left enabled across a Station restart.
// Failures are recorded but never block Station startup (optional module).
func (c *Catalog) RecoverActive(ctx context.Context) []error {
	var enabled []persistence.ChannelPlugin
	if err := c.db.Where("enabled = ?", true).Find(&enabled).Error; err != nil {
		return []error{err}
	}
	var failures []error
	for _, r := range enabled {
		if _, err := c.Enable(ctx, r.ID); err != nil {
			failures = append(failures, fmt.Errorf("recover plugin %s: %w", r.ID, err))
		}
	}
	return failures
}

// watchExit marks an enabled plugin failed if its process dies unexpectedly.
func (c *Catalog) watchExit(id string, state *pluginruntime.State) {
	go func() {
		<-state.Exited()
		c.mu.Lock()
		current := c.running[id]
		unexpectedExit := current == state
		if current == state {
			delete(c.running, id)
		}
		c.mu.Unlock()
		if !unexpectedExit {
			return
		}

		record, err := c.load(id)
		if err != nil || !record.Enabled {
			return // intentional stop / already removed
		}
		exitAt := time.Now().UTC()
		msg := "plugin process exited"
		if e := state.ExitError(); e != nil {
			msg = "plugin process exited: " + e.Error()
		}
		_ = c.mark(id, true, StateFailed, msg, nil, exitAt)

		c.mu.Lock()
		observer := c.crashObserver
		c.mu.Unlock()
		if observer != nil {
			observer(id)
		}
	}()
}

func (c *Catalog) load(id string) (*persistence.ChannelPlugin, error) {
	r := &persistence.ChannelPlugin{}
	err := c.db.Where("id = ?", id).Take(r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrPluginNotFound
	}
	return r, err
}

func (c *Catalog) mark(id string, enabled bool, lifecycle, msg string, started *time.Time, exited ...time.Time) error {
	updates := map[string]any{
		"enabled":    enabled,
		"lifecycle":  lifecycle,
		"health_msg": msg,
		"updated_at": time.Now().UTC(),
	}
	if started != nil {
		updates["last_start_at"] = *started
	}
	if len(exited) > 0 {
		updates["last_exit_at"] = exited[0]
	}
	return c.db.Model(&persistence.ChannelPlugin{}).Where("id = ?", id).Updates(updates).Error
}

func toView(r persistence.ChannelPlugin) PluginView {
	var caps []string
	if r.Capabilities != "" {
		_ = json.Unmarshal([]byte(r.Capabilities), &caps)
	}
	return PluginView{
		ID:           r.ID,
		Name:         r.Name,
		Version:      r.Version,
		ProviderKind: r.ProviderKind,
		Description:  r.Description,
		Enabled:      r.Enabled,
		Lifecycle:    r.Lifecycle,
		HealthMsg:    r.HealthMsg,
		Capabilities: caps,
		InstalledAt:  r.InstalledAt,
		LastStartAt:  r.LastStartAt,
	}
}
