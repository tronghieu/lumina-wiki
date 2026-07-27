package main

import (
	"errors"
	"path/filepath"

	desktopai "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/secrets"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
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
	return desktopai.NewService(desktopai.Dependencies{
		ConsentAccess: consentAccess,
		Windows:       desktopai.NewWailsWindowResolver(),
		Native:        native,
		Validator:     validator,
		Attacher:      identityManager,
		Runtimes:      runtimes,
		Sessions:      session.NewRegistry(session.Options{}),
		Streams:       desktopai.NewWailsStreamSinkFactory(),
		Settings:      configStore,
		Credentials:   credentialManager,
	})
}
