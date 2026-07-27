package session

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDisplayLabelRejectsPathsAndUnsafeUnicodeBeforeReplacement(t *testing.T) {
	invalidUTF8 := string([]byte{'w', 's', 0xff})
	for name, label := range map[string]string{
		"unix absolute root":  "/Users/alice/private-wiki",
		"windows drive root":  `C:\Users\alice\private-wiki`,
		"relative path":       "notes/private-wiki",
		"control character":   "private\nwiki",
		"format character":    "private\u202Ewiki",
		"invalid utf8":        invalidUTF8,
		"oversized":           strings.Repeat("a", maxDisplayLabel+1),
		"current directory":   ".",
		"parent directory":    "..",
		"backslash-separated": `notes\private-wiki`,
	} {
		t.Run(name, func(t *testing.T) {
			registry := NewRegistry(Options{Random: entropy(1, 2)})
			activeRuntime := &runtimeSpy{}
			active := activate(t, registry, 1, activeRuntime)
			incomingRuntime := &runtimeSpy{}

			_, err := registry.Activate(1, testWorkspaceID, DisplayMetadata{Label: label}, incomingRuntime)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("err=%v", err)
			}
			if strings.Contains(err.Error(), label) {
				t.Fatalf("error disclosed label: %q", err)
			}
			if incomingRuntime.closeCount() != 1 || activeRuntime.closeCount() != 0 {
				t.Fatalf("incoming closes=%d active closes=%d", incomingRuntime.closeCount(), activeRuntime.closeCount())
			}
			lease, resolveErr := registry.Resolve(1, active.Reference())
			if resolveErr != nil {
				t.Fatalf("active capability was replaced: %v", resolveErr)
			}
			lease.Finish()
			next := activate(t, registry, 1, &runtimeSpy{})
			if next.Generation != active.Generation+1 {
				t.Fatalf("rejected label consumed generation: active=%d next=%d", active.Generation, next.Generation)
			}
		})
	}
}

func TestCapabilityJSONContainsSafeUnicodeLabelWithoutBackendPaths(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1)})
	capability, err := registry.Activate(1, testWorkspaceID, DisplayMetadata{Label: "Nghiên cứu 🧭"}, &runtimeSpy{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(capability)
	if err != nil {
		t.Fatal(err)
	}

	var dto map[string]any
	if err := json.Unmarshal(raw, &dto); err != nil {
		t.Fatal(err)
	}
	display, ok := dto["Display"].(map[string]any)
	if !ok || display["Label"] != "Nghiên cứu 🧭" {
		t.Fatalf("display=%#v json=%s", dto["Display"], raw)
	}
	assertNoBackendData(t, dto, []string{"/Users/alice/private-wiki", `C:\Users\alice\private-wiki`})
}

func assertNoBackendData(t *testing.T, value any, forbiddenValues []string) {
	t.Helper()
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			lower := strings.ToLower(key)
			if strings.Contains(lower, "window") || strings.Contains(lower, "root") || strings.Contains(lower, "path") {
				t.Fatalf("backend field leaked: %s", key)
			}
			assertNoBackendData(t, child, forbiddenValues)
		}
	case []any:
		for _, child := range typed {
			assertNoBackendData(t, child, forbiddenValues)
		}
	case string:
		for _, forbidden := range forbiddenValues {
			if strings.Contains(typed, forbidden) {
				t.Fatalf("backend value leaked: %s", typed)
			}
		}
	}
}
