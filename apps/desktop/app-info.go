package main

type appMetadata struct {
	Name        string
	Description string
}

func appInfo() appMetadata {
	return appMetadata{
		Name:        "Lumina Wiki",
		Description: "Local-first desktop companion for Lumina Wiki workspaces",
	}
}
