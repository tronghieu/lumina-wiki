package main

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	desktopai "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func newAIService(app *application.App, workspaceService *desktopworkspace.Service, configBase string) (*desktopai.Service, error) {
	if app == nil || workspaceService == nil || configBase == "" || !filepath.IsAbs(configBase) {
		return nil, errors.New("valid AI service composition is required")
	}
	configStore, err := settings.NewConfigStore(configBase)
	if err != nil {
		return nil, err
	}
	identityManager, err := workspaceid.NewManager(configBase, workspaceid.Options{})
	if err != nil {
		return nil, err
	}
	credentialManager, err := secrets.NewManager(secrets.NewKeyringStore(), secrets.ManagerOptions{})
	if err != nil {
		return nil, err
	}
	validator, err := desktopai.NewWorkspaceValidatorAdapter(workspaceService)
	if err != nil {
		return nil, err
	}
	native, err := desktopai.NewWailsNativeAuthority(app)
	if err != nil {
		return nil, err
	}
	windowResolver := desktopai.NewWailsWindowResolver()
	bundle, err := contract.Load()
	if err != nil {
		return nil, err
	}
	provisioner, err := desktopworkspace.NewProvisioner(bundle, configBase, desktopworkspace.ProvisionOptions{
		ApproveExistingEmpty: func(ctx context.Context, destination string) error {
			window, resolveErr := windowResolver.ResolveWindow(ctx)
			if resolveErr != nil {
				return desktopworkspace.ErrEmptyNeedsApproval
			}
			approved, approvalErr := native.ConfirmUseEmptyDirectory(ctx, window, destination)
			if approvalErr != nil || !approved {
				return desktopworkspace.ErrEmptyNeedsApproval
			}
			return nil
		},
	})
	if err != nil {
		return nil, err
	}
	consentAccess := desktopai.NewConsentAccessGate()
	runtimes, err := desktopai.NewLoadedRuntimeFactory(desktopai.LoadedRuntimeDependencies{
		ConsentAccess: consentAccess,
		Trust:         identityManager,
		Config:        configStore,
		Credentials:   credentialManager,
		Client:        providers.SafeClient{},
		HistoryBase:   filepath.Clean(configBase),
	})
	if err != nil {
		return nil, err
	}
	library := desktopai.LibraryProvisioningDependencies{
		Provisioner: provisioner,
		DefaultParent: func() (string, error) {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			return defaultLibraryParentFromHome(home)
		},
	}
	libraryState, err := appstate.NewStore(filepath.Clean(configBase))
	if err != nil {
		return nil, err
	}
	return desktopai.NewService(desktopai.Dependencies{
		ConsentAccess: consentAccess,
		Windows:       windowResolver,
		Native:        native,
		Validator:     validator,
		Attacher:      identityManager,
		Runtimes:      runtimes,
		Sessions:      session.NewRegistry(session.Options{}),
		Streams:       desktopai.NewWailsStreamSinkFactory(),
		Settings:      configStore,
		Credentials:   credentialManager,
		Library:       &library,
		LibraryState:  libraryState,
	})
}

func defaultLibraryParentFromHome(home string) (string, error) {
	if home == "" || !filepath.IsAbs(home) || filepath.Clean(home) != home {
		return "", errors.New("valid home directory is required")
	}
	if physicalDirectory(filepath.Join(home, "Documents")) {
		return filepath.Join(home, "Documents"), nil
	}
	if physicalDirectory(home) {
		return home, nil
	}
	return "", errors.New("home directory is unavailable")
}

func physicalDirectory(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.IsDir() && info.Mode()&fs.ModeSymlink == 0
}
