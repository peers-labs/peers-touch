package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/applet_store/service"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type manifestFile struct {
	ID                 string               `json:"id"`
	Name               string               `json:"name"`
	Version            string               `json:"version"`
	Description        string               `json:"description"`
	Author             string               `json:"author"`
	MinPlatformVersion string               `json:"minPlatformVersion"`
	Targets            []string             `json:"targets"`
	TargetPlatforms    []string             `json:"targetPlatforms"`
	Entries            manifestEntries      `json:"entries"`
	Load               map[string]loadEntry `json:"load"`
	Bridge             manifestBridge       `json:"bridge"`
	Permissions        []string             `json:"permissions"`
	Capabilities       []string             `json:"capabilities"`
	Integrity          manifestIntegrity    `json:"integrity"`
	Services           []serviceDeclaration `json:"services"`
}

type manifestEntries struct {
	Lynx string `json:"lynx"`
}

type loadEntry struct {
	Type  string `json:"type"`
	Entry string `json:"entry"`
}

type manifestBridge struct {
	Protocol string `json:"protocol"`
}

type manifestIntegrity struct {
	Files map[string]string `json:"files"`
}

type serviceDeclaration struct {
	ID                string   `json:"id"`
	Kind              string   `json:"kind"`
	AllowedMethods    []string `json:"allowedMethods"`
	AllowedPaths      []string `json:"allowedPaths"`
	Streaming         bool     `json:"streaming"`
	StationPathPrefix string   `json:"stationPathPrefix"`
}

type cliConfig struct {
	repoRoot    string
	dbPath      string
	storagePath string
}

func main() {
	config := parseGlobalFlags()
	if len(flag.Args()) == 0 {
		fail("usage: store_cli <publish|install|revoke> [args]")
	}

	svc := openService(config)
	switch flag.Arg(0) {
	case "publish":
		runPublish(svc, config, flag.Args()[1:])
	case "install":
		runInstall(svc, flag.Args()[1:])
	case "revoke":
		runRevoke(svc, flag.Args()[1:])
	default:
		fail("unknown command: %s", flag.Arg(0))
	}
}

func parseGlobalFlags() cliConfig {
	repoRoot := flag.String("repo-root", "", "repository root")
	dbPath := flag.String("db", "", "sqlite database path")
	storagePath := flag.String("storage", "", "bundle storage path")
	flag.Parse()

	root := *repoRoot
	if root == "" {
		wd, err := os.Getwd()
		if err != nil {
			fail("resolve working directory: %v", err)
		}
		root = wd
	}
	defaultRoot := filepath.Join(root, "tooling/acceptance/evidence/applets", "station-store", "cli-store")
	if *dbPath == "" {
		*dbPath = filepath.Join(defaultRoot, "store.sqlite")
	}
	if *storagePath == "" {
		*storagePath = filepath.Join(defaultRoot, "bundles")
	}
	return cliConfig{repoRoot: root, dbPath: *dbPath, storagePath: *storagePath}
}

func openService(config cliConfig) *service.StoreService {
	if err := os.MkdirAll(filepath.Dir(config.dbPath), 0755); err != nil {
		fail("create store directory: %v", err)
	}
	db, err := gorm.Open(sqlite.Open(config.dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		fail("open sqlite store: %v", err)
	}
	svc := service.NewStoreService(db, config.storagePath)
	if err := svc.Migrate(); err != nil {
		fail("migrate store: %v", err)
	}
	return svc
}

func runPublish(svc *service.StoreService, config cliConfig, args []string) {
	flags := flag.NewFlagSet("publish", flag.ExitOnError)
	packageDir := flags.String("package-dir", "", "applet package directory")
	channel := flags.String("channel", "dev", "release channel")
	ownerID := flags.String("owner", "cli", "owner id")
	if err := flags.Parse(args); err != nil {
		fail("parse publish flags: %v", err)
	}
	if *packageDir == "" && flags.NArg() > 0 {
		*packageDir = flags.Arg(0)
	}
	if *packageDir == "" {
		fail("publish requires <package-dir>")
	}

	dir := resolvePath(config.repoRoot, *packageDir)
	manifestPath := filepath.Join(dir, "manifest.json")
	rawManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		fail("read manifest.json: %v", err)
	}

	var manifest manifestFile
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		fail("parse manifest.json: %v", err)
	}
	if err := validateManifestIntegrity(dir, manifest); err != nil {
		fail("validate manifest integrity: %v", err)
	}

	entry := bundleEntry(manifest)
	expectedBundleDigest := manifest.Integrity.Files[entry]
	bundle, err := svc.SaveBundleFromPath(manifest.ID, manifest.Version, filepath.Join(dir, entry), entry, expectedBundleDigest)
	if err != nil {
		fail("save bundle: %v", err)
	}
	bundle.Assets = saveBundleAssets(svc, dir, manifest)

	policy := policyFromManifest(manifest)
	response, err := svc.PublishAppletVersion(&model.PublishAppletRequest{
		Name:          manifest.Name,
		Description:   manifest.Description,
		Version:       manifest.Version,
		MinSdkVersion: manifest.MinPlatformVersion,
		AppletId:      manifest.ID,
		OwnerId:       *ownerID,
		Channel:       parseChannel(*channel),
		Manifest: &model.ManifestSnapshot{
			ManifestJson:    string(rawManifest),
			TargetPlatforms: targetPlatforms(manifest),
			Permissions:     manifest.Permissions,
			Capabilities:    manifest.Capabilities,
			Integrity:       manifest.Integrity.Files,
			Services:        policy.ServicePolicies,
			BridgeProtocol:  manifest.Bridge.Protocol,
			RuntimeType:     runtimeType(manifest),
		},
		Bundle: bundle,
		Policy: policy,
	})
	if err != nil {
		fail("publish applet version: %v", err)
	}
	writeJSON(response)
}

func runInstall(svc *service.StoreService, args []string) {
	flags := flag.NewFlagSet("install", flag.ExitOnError)
	channel := flags.String("channel", "dev", "release channel")
	actorID := flags.String("actor", "cli-user", "actor id")
	deviceID := flags.String("device", "cli-device", "device id")
	if err := flags.Parse(args); err != nil {
		fail("parse install flags: %v", err)
	}
	if flags.NArg() == 0 {
		fail("install requires <applet-id>")
	}
	response, err := svc.InstallApplet(&model.InstallAppletRequest{
		ActorId:  *actorID,
		DeviceId: *deviceID,
		AppletId: flags.Arg(0),
		Channel:  parseChannel(*channel),
	})
	if err != nil {
		fail("install applet: %v", err)
	}
	writeJSON(response)
}

func runRevoke(svc *service.StoreService, args []string) {
	flags := flag.NewFlagSet("revoke", flag.ExitOnError)
	version := flags.String("version", "", "version to revoke")
	reason := flags.String("reason", "cli_revoke", "revoke reason")
	operatorID := flags.String("operator", "cli", "operator id")
	if err := flags.Parse(args); err != nil {
		fail("parse revoke flags: %v", err)
	}
	if flags.NArg() == 0 {
		fail("revoke requires <applet-id>")
	}
	if *version == "" {
		fail("revoke requires --version <version>")
	}
	response, err := svc.RevokeAppletVersion(&model.RevokeAppletVersionRequest{
		AppletId:   flags.Arg(0),
		Version:    *version,
		Reason:     *reason,
		OperatorId: *operatorID,
	})
	if err != nil {
		fail("revoke applet: %v", err)
	}
	writeJSON(response)
}

func validateManifestIntegrity(packageDir string, manifest manifestFile) error {
	if manifest.ID == "" || manifest.Version == "" || manifest.Name == "" {
		return fmt.Errorf("manifest id, name, and version are required")
	}
	if len(manifest.Integrity.Files) == 0 {
		return fmt.Errorf("manifest integrity files are required")
	}
	entry := bundleEntry(manifest)
	if entry == "" {
		return fmt.Errorf("desktop bundle entry is required")
	}
	for relativePath, expected := range manifest.Integrity.Files {
		actual, _, err := hashFile(filepath.Join(packageDir, relativePath))
		if err != nil {
			return err
		}
		if actual != expected {
			return fmt.Errorf("integrity mismatch for %s: expected %s got %s", relativePath, expected, actual)
		}
	}
	return nil
}

func saveBundleAssets(svc *service.StoreService, packageDir string, manifest manifestFile) []*model.BundleAssetIntegrity {
	assets := make([]*model.BundleAssetIntegrity, 0, len(manifest.Integrity.Files))
	for relativePath, digest := range manifest.Integrity.Files {
		stored, err := svc.SaveBundleFromPath(manifest.ID, manifest.Version, filepath.Join(packageDir, relativePath), relativePath, digest)
		if err != nil {
			fail("save integrity file %s: %v", relativePath, err)
		}
		assets = append(assets, &model.BundleAssetIntegrity{
			Path:        relativePath,
			Sha256:      digest,
			SizeBytes:   stored.GetBundleSizeBytes(),
			ContentType: contentType(relativePath),
		})
	}
	return assets
}

func policyFromManifest(manifest manifestFile) *model.AppletPolicySet {
	policy := &model.AppletPolicySet{
		PolicyId: manifest.ID + "-" + manifest.Version,
		AppletId: manifest.ID,
		Version:  manifest.Version,
	}
	for _, permission := range manifest.Permissions {
		policy.CapabilityPolicies = append(policy.CapabilityPolicies, &model.AppletCapabilityPolicy{
			Capability: permission,
			Methods:    []string{permission},
			Decision:   model.AppletPolicyDecision_APPLET_POLICY_DECISION_ALLOW,
		})
	}
	for _, declaration := range manifest.Services {
		policy.ServicePolicies = append(policy.ServicePolicies, &model.AppletServicePolicy{
			ServiceId:         declaration.ID,
			Kind:              declaration.Kind,
			AllowedMethods:    declaration.AllowedMethods,
			AllowedPaths:      declaration.AllowedPaths,
			Streaming:         declaration.Streaming,
			StationPathPrefix: declaration.StationPathPrefix,
			Decision:          model.AppletPolicyDecision_APPLET_POLICY_DECISION_ALLOW,
		})
	}
	return policy
}

func bundleEntry(manifest manifestFile) string {
	if desktop, ok := manifest.Load["desktop"]; ok && desktop.Entry != "" {
		return desktop.Entry
	}
	return manifest.Entries.Lynx
}

func runtimeType(manifest manifestFile) string {
	if desktop, ok := manifest.Load["desktop"]; ok {
		return desktop.Type
	}
	return ""
}

func targetPlatforms(manifest manifestFile) []string {
	if len(manifest.TargetPlatforms) > 0 {
		return manifest.TargetPlatforms
	}
	return manifest.Targets
}

func parseChannel(value string) model.AppletReleaseChannel {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "stable":
		return model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_STABLE
	case "beta":
		return model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_BETA
	case "dev", "":
		return model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_DEV
	default:
		fail("unsupported channel: %s", value)
	}
	return model.AppletReleaseChannel_APPLET_RELEASE_CHANNEL_UNSPECIFIED
}

func hashFile(path string) (string, int64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", 0, err
	}
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:]), int64(len(data)), nil
}

func contentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".json":
		return "application/json"
	case ".bundle", ".js":
		return "application/javascript"
	default:
		return "application/octet-stream"
	}
}

func resolvePath(root, value string) string {
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	return filepath.Join(root, value)
}

func writeJSON(value any) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		fail("encode response: %v", err)
	}
}

func fail(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, "FAIL "+format+"\n", args...)
	os.Exit(1)
}
