package settings

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestNewConfigStoreRequiresAbsoluteTrustedBase(t *testing.T) {
	before, err := os.Stat(".")
	if err != nil {
		t.Fatalf("stat cwd: %v", err)
	}
	for _, base := range []string{"", "relative", "."} {
		if _, err := NewConfigStore(base); err == nil {
			t.Fatalf("expected base %q to be rejected", base)
		}
	}
	after, _ := os.Stat(".")
	if after.Mode().Perm() != before.Mode().Perm() {
		t.Fatal("rejected base must not chmod the current directory")
	}
}

func TestLoadMissingReturnsDefaultConfig(t *testing.T) {
	store, _, _ := newTestStore(t)
	config, err := store.Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if config.SchemaVersion != CurrentSchemaVersion || config.Chat != nil || config.Embedding != nil {
		t.Fatalf("unexpected default config: %#v", config)
	}
}

func TestLoadFailsClosedForMalformedUnknownOrOversizedConfig(t *testing.T) {
	tests := []struct {
		name    string
		content []byte
	}{
		{"malformed", []byte("{not-json")},
		{"unknown version", []byte(`{"schemaVersion":99}`)},
		{"oversized", []byte(strings.Repeat(" ", MaxConfigBytes+1))},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store, _, path := newTestStore(t)
			writeConfigFixture(t, path, test.content)
			before, _ := os.ReadFile(path)
			if _, err := store.Load(); err == nil {
				t.Fatal("expected load error")
			}
			after, _ := os.ReadFile(path)
			if string(after) != string(before) {
				t.Fatal("failed load must not change original file")
			}
		})
	}
}

func TestLoadPropagatesStableOpenErrorWithoutRetryExhaustion(t *testing.T) {
	store, _, path := newTestStore(t)
	writeConfigFixture(t, path, []byte(`{"schemaVersion":1}`))
	attempts := 0
	store.openFile = func(string) (*os.File, error) {
		attempts++
		return nil, fs.ErrPermission
	}
	_, err := store.Load()
	if !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("expected wrapped permission error, got %v", err)
	}
	if !strings.Contains(err.Error(), "open config") {
		t.Fatalf("expected actionable open context, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("stable open error must not retry, got %d attempts", attempts)
	}
}

func TestLoadRejectsMoreThanTwoProfileOccurrences(t *testing.T) {
	chat, _ := json.Marshal(validProfile(RoleChat, ProviderOpenAI))
	embedding, _ := json.Marshal(validProfile(RoleEmbedding, ProviderOpenAI))
	for _, duplicateKey := range []string{"chat", "CHAT"} {
		t.Run(duplicateKey, func(t *testing.T) {
			store, _, path := newTestStore(t)
			raw := []byte(`{"schemaVersion":1,"chat":` + string(chat) + `,"embedding":` + string(embedding) + `,"` + duplicateKey + `":` + string(chat) + `}`)
			writeConfigFixture(t, path, raw)
			if _, err := store.Load(); err == nil {
				t.Fatal("duplicate chat slot must not create a third profile occurrence")
			}
		})
	}
}

func TestSaveOwnsOnlyFixedPrivateChild(t *testing.T) {
	base := t.TempDir()
	if runtime.GOOS != "windows" {
		if err := os.Chmod(base, 0o755); err != nil {
			t.Fatalf("make base permissive: %v", err)
		}
	}
	store, err := NewConfigStore(base)
	if err != nil {
		t.Fatalf("NewConfigStore returned error: %v", err)
	}
	if err := store.Save(DefaultConfig()); err != nil {
		t.Fatalf("Save returned error: %v", err)
	}
	baseInfo, _ := os.Stat(base)
	dirInfo, _ := os.Stat(store.dir)
	fileInfo, _ := os.Stat(store.path)
	if runtime.GOOS != "windows" {
		if baseInfo.Mode().Perm() != 0o755 {
			t.Fatalf("trusted base permissions changed to %o", baseInfo.Mode().Perm())
		}
		if dirInfo.Mode().Perm() != 0o700 || fileInfo.Mode().Perm() != 0o600 {
			t.Fatalf("expected owned dir/file 0700/0600, got %o/%o", dirInfo.Mode().Perm(), fileInfo.Mode().Perm())
		}
	}
}

func TestLoadAndSaveRejectSymlinkedOwnedDirectory(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	store, err := NewConfigStore(base)
	if err != nil {
		t.Fatalf("NewConfigStore returned error: %v", err)
	}
	if err := os.Symlink(outside, store.dir); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("expected symlinked owned directory load rejection")
	}
	if err := store.Save(DefaultConfig()); err == nil {
		t.Fatal("expected symlinked owned directory save rejection")
	}
}

func TestLoadAndSaveRejectOwnedPathThatIsNotDirectory(t *testing.T) {
	base := t.TempDir()
	store, err := NewConfigStore(base)
	if err != nil {
		t.Fatalf("NewConfigStore returned error: %v", err)
	}
	if err := os.WriteFile(store.dir, []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("write blocking owned path: %v", err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("expected non-directory owned path load rejection")
	}
	if err := store.Save(DefaultConfig()); err == nil {
		t.Fatal("expected non-directory owned path save rejection")
	}
}

func TestLoadAndSaveRejectConfigPathSymlink(t *testing.T) {
	store, _, path := newTestStore(t)
	target := filepath.Join(t.TempDir(), "target.json")
	original := []byte("do not overwrite")
	if err := os.WriteFile(target, original, 0o600); err != nil {
		t.Fatalf("write target: %v", err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("expected symlink load rejection")
	}
	if err := store.Save(DefaultConfig()); err == nil {
		t.Fatal("expected symlink save rejection")
	}
	after, _ := os.ReadFile(target)
	if string(after) != string(original) {
		t.Fatal("symlink target was modified")
	}
}

func TestSaveAtomicallyOverwritesWithNormalizedDeterministicJSON(t *testing.T) {
	store, _, path := newTestStore(t)
	first := configWithChatModel("model-1")
	first.Chat.BaseURL = "https://EXAMPLE.com:443/v1/?z=2&a=1"
	if err := store.Save(first); err != nil {
		t.Fatalf("first Save returned error: %v", err)
	}
	before, _ := os.ReadFile(path)
	if !strings.HasSuffix(string(before), "\n") || !strings.Contains(string(before), `"baseUrl": "https://example.com/v1?a=1&z=2"`) {
		t.Fatalf("saved JSON not formatted and normalized: %s", before)
	}
	if err := store.Save(configWithChatModel("model-2")); err != nil {
		t.Fatalf("second Save returned error: %v", err)
	}
	after, _ := os.ReadFile(path)
	if string(after) == string(before) || !strings.Contains(string(after), `"model": "model-2"`) {
		t.Fatalf("atomic overwrite did not replace content: %s", after)
	}
	assertNoTempFiles(t, path)
}

func TestSaveValidatesBeforeWriteAndPreservesOldFile(t *testing.T) {
	store, _, path := newTestStore(t)
	old := []byte("old config stays")
	writeConfigFixture(t, path, old)
	invalid := configWithChatModel("model-1")
	invalid.Chat.CredentialRef = strings.Repeat("x", MaxCredentialRefBytes+1)
	if err := store.Save(invalid); err == nil {
		t.Fatal("expected invalid config rejection")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(old) {
		t.Fatal("failed save changed previous file")
	}
	assertNoTempFiles(t, path)
}

func TestFailedRenameCleansTemporaryFile(t *testing.T) {
	store, _, path := newTestStore(t)
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatalf("create blocking directory: %v", err)
	}
	if err := store.Save(DefaultConfig()); err == nil {
		t.Fatal("expected rename failure")
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		t.Fatal("failed save must leave prior path unchanged")
	}
	assertNoTempFiles(t, path)
}

func TestConcurrentLoadSaveAlwaysObservesCompleteConfig(t *testing.T) {
	store, _, _ := newTestStore(t)
	if err := store.Save(configWithChatModel("model-a")); err != nil {
		t.Fatalf("initial Save: %v", err)
	}
	errorsSeen := make(chan error, 500)
	var wait sync.WaitGroup
	wait.Add(5)
	go func() {
		defer wait.Done()
		for index := 0; index < 100; index++ {
			model := "model-a"
			if index%2 == 1 {
				model = "model-b"
			}
			if err := store.Save(configWithChatModel(model)); err != nil {
				errorsSeen <- err
			}
		}
	}()
	for range 4 {
		go func() {
			defer wait.Done()
			for range 100 {
				config, err := store.Load()
				if err != nil {
					errorsSeen <- err
					continue
				}
				if config.Chat == nil || (config.Chat.Model != "model-a" && config.Chat.Model != "model-b") {
					errorsSeen <- &visibilityError{model: config.Chat}
				}
			}
		}()
	}
	wait.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		t.Errorf("concurrent visibility failure: %v", err)
	}
}

type visibilityError struct{ model *Profile }

func (e *visibilityError) Error() string { return "observed incomplete config" }

func newTestStore(t *testing.T) (*ConfigStore, string, string) {
	t.Helper()
	base := t.TempDir()
	store, err := NewConfigStore(base)
	if err != nil {
		t.Fatalf("NewConfigStore returned error: %v", err)
	}
	if err := os.Mkdir(store.dir, 0o700); err != nil {
		t.Fatalf("create owned directory: %v", err)
	}
	return store, store.dir, store.path
}

func writeConfigFixture(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("create config directory: %v", err)
	}
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("write config fixture: %v", err)
	}
}

func configWithChatModel(model string) Config {
	config := DefaultConfig()
	config.Chat = profilePtr(validProfile(RoleChat, ProviderOpenAICompatible))
	config.Chat.Model = model
	return config
}

func assertNoTempFiles(t *testing.T, configPath string) {
	t.Helper()
	entries, err := os.ReadDir(filepath.Dir(configPath))
	if err != nil {
		t.Fatalf("read config directory: %v", err)
	}
	prefix := "." + filepath.Base(configPath) + ".tmp-"
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			t.Fatalf("temporary file was not cleaned: %s", entry.Name())
		}
	}
}
