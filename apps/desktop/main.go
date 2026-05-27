package main

import (
	"embed"
	"log"

	desktopgraph "github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
	desktopworkspace "github.com/tronghieu/lumina-wiki/apps/desktop/internal/workspace"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	info := appInfo()
	app := application.New(application.Options{
		Name:        info.Name,
		Description: info.Description,
		Services: []application.Service{
			application.NewService(desktopworkspace.NewService()),
			application.NewService(desktopgraph.NewService()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: info.Name,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(247, 248, 252),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
