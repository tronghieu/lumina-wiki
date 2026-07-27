package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClassifyManifestCompatibilityTable(t *testing.T) {
	tests := []struct {
		name     string
		manifest string
		csv      bool
		want     TargetState
	}{
		{"legacy missing", "", false, TargetLegacy},
		{"legacy null", `{"schemaVersion":null}`, true, TargetCompatible},
		{"supported one", `{"schemaVersion":1}`, true, TargetCompatible},
		{"supported four", `{"schemaVersion":4}`, true, TargetCompatible},
		{"newer", `{"schemaVersion":5}`, true, TargetNewer},
		{"fractional", `{"schemaVersion":1.5}`, true, TargetMalformed},
		{"duplicate", `{"schemaVersion":4,"schemaVersion":4}`, true, TargetMalformed},
		{"trailing", `{"schemaVersion":4}{}`, true, TargetMalformed},
		{"missing CSV", `{"schemaVersion":4}`, false, TargetMalformed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# x"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
				t.Fatal(err)
			}
			if test.manifest != "" {
				if err := os.Mkdir(filepath.Join(root, "_lumina"), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(root, "_lumina", "manifest.json"), []byte(test.manifest), 0o600); err != nil {
					t.Fatal(err)
				}
				if test.csv {
					if err := os.Mkdir(filepath.Join(root, "_lumina", "_state"), 0o700); err != nil {
						t.Fatal(err)
					}
					headers := map[string]string{
						"skills-manifest.csv": "canonical_id,display_name,pack,source,relative_path,target_link_path,version\n",
						"files-manifest.csv":  "relative_path,sha256,source_pack,installed_version\n",
					}
					for name, header := range headers {
						if err := os.WriteFile(filepath.Join(root, "_lumina", "_state", name), []byte(header), 0o600); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			got, err := classifyExistingRoot(context.Background(), root)
			if err != nil {
				t.Fatal(err)
			}
			if got.State != test.want {
				t.Fatalf("state=%s want=%s", got.State, test.want)
			}
		})
	}
}

func TestClassifyRejectsFilesManifestHashMismatch(t *testing.T) {
	root := t.TempDir()
	for _, directory := range []string{"wiki", "_lumina/_state"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(directory)), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# x"), 0o600); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"_lumina/manifest.json":              `{"schemaVersion":4}`,
		"_lumina/_state/skills-manifest.csv": "canonical_id,display_name,pack,source,relative_path,target_link_path,version\n",
		"_lumina/_state/files-manifest.csv":  "relative_path,sha256,source_pack,installed_version\nREADME.md," + strings.Repeat("0", 64) + ",core,1.0.0\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(name)), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	got, err := classifyExistingRoot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != TargetMalformed {
		t.Fatalf("classification=%+v", got)
	}
}
