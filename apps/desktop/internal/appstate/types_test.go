package appstate

import (
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestArtifactLocatorV1Validation(t *testing.T) {
	valid := ArtifactLocatorV1{Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/concepts/hello-world.md"}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid locator: %v", err)
	}
	for name, locator := range map[string]ArtifactLocatorV1{
		"version":      {Version: 2, Kind: ArtifactWikiNote, RelativePath: "wiki/a.md"},
		"kind":         {Version: 1, Kind: "pdf", RelativePath: "wiki/a.md"},
		"absolute":     {Version: 1, Kind: ArtifactWikiNote, RelativePath: "/wiki/a.md"},
		"traversal":    {Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/../a.md"},
		"backslash":    {Version: 1, Kind: ArtifactWikiNote, RelativePath: `wiki\a.md`},
		"colon":        {Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/C:/a.md"},
		"outside wiki": {Version: 1, Kind: ArtifactWikiNote, RelativePath: "raw/a.md"},
		"not markdown": {Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/a.txt"},
		"overlong":     {Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/" + strings.Repeat("a", MaxArtifactPathBytes) + ".md"},
	} {
		t.Run(name, func(t *testing.T) {
			if err := locator.Validate(); err == nil {
				t.Fatal("invalid locator accepted")
			}
		})
	}
}

func TestWorkspaceViewValidation(t *testing.T) {
	for _, focus := range []Focus{FocusChat, FocusNote, FocusGraph} {
		view := WorkspaceView{Focus: focus}
		if focus == FocusNote {
			view.Artifact = &ArtifactLocatorV1{Version: 1, Kind: ArtifactWikiNote, RelativePath: "wiki/note.md"}
		}
		if err := view.Validate(); err != nil {
			t.Fatalf("%s: %v", focus, err)
		}
	}
	if err := (WorkspaceView{Focus: "settings"}).Validate(); err == nil {
		t.Fatal("unsupported focus accepted")
	}
}

func testWorkspaceID(index byte) workspaceid.WorkspaceID {
	return workspaceid.WorkspaceID("ws_" + strings.Repeat(string("0123456789abcdef"[index%16]), 32))
}
