package tools

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRunCheckParsesSummaryFromWorkspaceScript(t *testing.T) {
	root := makeToolWorkspace(t, `if (!process.argv.includes("--summary")) process.exit(9);
if (!process.cwd().endsWith("workspace")) process.exit(8);
console.log(JSON.stringify({errors:1,warnings:2,by_check:{L01:1},fixable:1}));
process.exit(1);
`)
	service := NewService()
	result, err := service.RunCheck(root)
	if err != nil {
		t.Fatalf("RunCheck returned error: %v", err)
	}
	if result.Status != "issues" || result.Summary.Errors != 1 || result.Summary.Warnings != 2 || result.ExitCode != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunCheckRejectsMissingScript(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatalf("create wiki: %v", err)
	}
	if _, err := NewService().RunCheck(root); err == nil {
		t.Fatal("expected missing script error")
	}
}

func TestRunCheckReportsMissingNode(t *testing.T) {
	root := makeToolWorkspace(t, `console.log(JSON.stringify({errors:0,warnings:0,by_check:{},fixable:0}));`)
	service := NewService()
	service.NodePath = "definitely-missing-node-binary"
	if _, err := service.RunCheck(root); err == nil {
		t.Fatal("expected missing node error")
	}
}

func TestRunCheckTimesOut(t *testing.T) {
	root := makeToolWorkspace(t, `setTimeout(() => {}, 1000);`)
	service := NewService()
	service.Timeout = 1 * time.Millisecond
	if _, err := service.RunCheck(root); err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestRunCheckRejectsSymlinkedScriptsDirectory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatalf("create wiki: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README: %v", err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "lint.mjs"), []byte(`console.log("{}")`), 0o600); err != nil {
		t.Fatalf("write outside script: %v", err)
	}
	if err := os.Mkdir(filepath.Join(root, "_lumina"), 0o700); err != nil {
		t.Fatalf("create _lumina: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "_lumina", "scripts")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	if _, err := NewService().RunCheck(root); err == nil {
		t.Fatal("expected symlinked scripts directory rejection")
	}
}

func makeToolWorkspace(t *testing.T, script string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "workspace")
	if err := os.MkdirAll(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatalf("create wiki: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "_lumina", "scripts"), 0o700); err != nil {
		t.Fatalf("create scripts: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# Test"), 0o600); err != nil {
		t.Fatalf("write README: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "_lumina", "scripts", "lint.mjs"), []byte(script), 0o700); err != nil {
		t.Fatalf("write script: %v", err)
	}
	return root
}
