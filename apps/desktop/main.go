package main

import (
	"embed"
	"log"
	"os"

	desktopai "github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	info := appInfo()
	workspaceService := desktopworkspace.NewService()
	app := application.New(application.Options{
		Name:        info.Name,
		Description: info.Description,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	configBase, err := os.UserConfigDir()
	if err != nil {
		log.Fatal("Lumina Desktop could not open its private settings directory")
	}
	aiService, err := newAIService(app, workspaceService, configBase)
	if err != nil {
		log.Fatal("Lumina Desktop AI service could not start")
	}
	app.RegisterService(application.NewService(aiService))

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: info.Name,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(247, 248, 252),
		URL:              "/",
	})
	registerAIWindowCleanup(window, func(windowID session.WindowID) error {
		return desktopai.CloseWindow(aiService, windowID)
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
