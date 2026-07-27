package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/graph"
)

func TestReadWorkspaceNoteUsesAuthorizedRuntimeAndReturnsLocator(t *testing.T) {
	locator := ArtifactLocatorV1DTO{
		Version: ArtifactLocatorVersion, Kind: ArtifactKindWikiNote,
		RelativePath: "wiki/concepts/continuity.md",
	}
	runtime := &managementRuntimeStub{
		note: graph.NoteContent{Path: locator.RelativePath, Content: "continued"},
	}
	service, capability, _ := newBridgeService(t, 7, runtime)
	result, err := service.ReadWorkspaceNote(context.Background(), WorkspaceNoteRequestDTO{
		Session: bridgeReference(capability), Artifact: locator,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Artifact != locator || result.Content != "continued" {
		t.Fatalf("note = %#v", result)
	}
}

func TestReadWorkspaceNoteRejectsUnsafeLocatorBeforeRuntimeAndSanitizesFailures(t *testing.T) {
	runtime := &managementRuntimeStub{}
	service, capability, _ := newBridgeService(t, 7, runtime)
	request := WorkspaceNoteRequestDTO{
		Session: bridgeReference(capability),
		Artifact: ArtifactLocatorV1DTO{
			Version: ArtifactLocatorVersion, Kind: ArtifactKindWikiNote,
			RelativePath: "../private.md",
		},
	}
	if _, err := service.ReadWorkspaceNote(context.Background(), request); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unsafe locator = %v", err)
	}
	if calls, _ := runtime.counts(); calls != 0 {
		t.Fatalf("unsafe locator reached runtime: %d calls", calls)
	}

	private := "/private/library/wiki/concepts/note.md"
	runtime.err = errors.New(private)
	request.Artifact.RelativePath = "wiki/concepts/note.md"
	if _, err := service.ReadWorkspaceNote(context.Background(), request); !errors.Is(err, ErrWorkspaceNoteUnavailable) ||
		err.Error() == private {
		t.Fatalf("unsafe runtime error = %v", err)
	}
}
