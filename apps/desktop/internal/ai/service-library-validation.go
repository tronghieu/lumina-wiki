package ai

import "github.com/tronghieu/lumina-wiki/apps/desktop/internal/appstate"

const (
	MaxArtifactLocatorPathBytes = appstate.MaxArtifactPathBytes
	MaxWorkspaceNoteBytes       = 4 * 1024 * 1024
)

func validArtifactLocator(locator ArtifactLocatorV1DTO) bool {
	return (appstate.ArtifactLocatorV1{
		Version:      locator.Version,
		Kind:         appstate.ArtifactKind(locator.Kind),
		RelativePath: locator.RelativePath,
	}).Validate() == nil
}
