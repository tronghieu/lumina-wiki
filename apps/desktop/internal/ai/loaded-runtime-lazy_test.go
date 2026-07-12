package ai

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/chat"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/providers"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/retrieval"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/settings"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

func TestLoadedRuntimeFactoryLoadReadsOnlyTrustedRootIdentity(t *testing.T) {
	root := runtimeWorkspace(t)
	proof, err := os.Stat(root)
	if err != nil {
		t.Fatal(err)
	}
	trust := &runtimeTrustSpy{proof: proof}
	config := &runtimeConfigSpy{}
	credentials := &runtimeCredentialSpy{}
	reads := 0
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: trust, Config: config, Credentials: credentials, HistoryBase: t.TempDir(),
		LexicalFactory: func(context.Context, string, os.FileInfo) (*retrieval.Lexical, error) {
			reads++
			return nil, nil
		},
		HistoryFactory: func(string, workspaceid.WorkspaceID) (RuntimeHistoryStore, error) {
			reads++
			return nil, nil
		},
		ProviderFactory: func(settings.Profile, providers.SafeClient, CredentialResolver) (providers.ChatProvider, error) {
			reads++
			return nil, nil
		},
		RetrieverFactory: func(chat.HybridConfig) chat.RetrievalRunner {
			reads++
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := workspaceid.WorkspaceID("ws_11111111111111111111111111111111")
	runtime, err := factory.Load(context.Background(), id, root)
	if err != nil || runtime == nil {
		t.Fatalf("load = %#v, %v", runtime, err)
	}
	if trust.calls != 1 || trust.id != id || trust.root != root {
		t.Fatalf("trust calls = %#v", trust)
	}
	if config.calls != 0 || credentials.calls != 0 || reads != 0 {
		t.Fatalf("load performed eager reads: config=%d credentials=%d other=%d", config.calls, credentials.calls, reads)
	}
}

func TestLoadedRuntimeFactoryRejectsInvalidDependenciesAndLoadSafely(t *testing.T) {
	var typedNil *runtimeTrustSpy
	base := LoadedRuntimeDependencies{Trust: &runtimeTrustSpy{}, Config: &runtimeConfigSpy{}, Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir()}
	for name, mutate := range map[string]func(*LoadedRuntimeDependencies){
		"typed nil trust":  func(deps *LoadedRuntimeDependencies) { deps.Trust = typedNil },
		"nil config":       func(deps *LoadedRuntimeDependencies) { deps.Config = nil },
		"nil credentials":  func(deps *LoadedRuntimeDependencies) { deps.Credentials = nil },
		"relative history": func(deps *LoadedRuntimeDependencies) { deps.HistoryBase = "relative" },
	} {
		t.Run(name, func(t *testing.T) {
			deps := base
			mutate(&deps)
			if factory, err := NewLoadedRuntimeFactory(deps); factory != nil || err == nil {
				t.Fatalf("invalid dependencies accepted = %#v, %v", factory, err)
			}
		})
	}
	factory, err := NewLoadedRuntimeFactory(base)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		id   workspaceid.WorkspaceID
		root string
	}{{"bad", t.TempDir()}, {"ws_11111111111111111111111111111111", "relative"}} {
		if runtime, err := factory.Load(context.Background(), test.id, test.root); runtime != nil || err != ErrRuntimeLoad {
			t.Fatalf("invalid load = %#v, %v", runtime, err)
		}
	}
}

func TestLoadedRuntimeFactoryRejectsTypedNilRootProofWithoutPanic(t *testing.T) {
	var proof *typedNilFileInfo
	factory, err := NewLoadedRuntimeFactory(LoadedRuntimeDependencies{
		Trust: &runtimeTrustSpy{proof: proof}, Config: &runtimeConfigSpy{}, Credentials: &runtimeCredentialSpy{}, HistoryBase: t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("typed-nil proof panicked: %v", recovered)
		}
	}()
	runtime, err := factory.Load(context.Background(), "ws_11111111111111111111111111111111", runtimeWorkspace(t))
	if runtime != nil || err != ErrRuntimeLoad {
		t.Fatalf("typed-nil proof accepted = %#v, %v", runtime, err)
	}
}

type typedNilFileInfo struct{}

func (*typedNilFileInfo) Name() string       { return "" }
func (*typedNilFileInfo) Size() int64        { return 0 }
func (*typedNilFileInfo) Mode() os.FileMode  { return 0 }
func (*typedNilFileInfo) ModTime() time.Time { return time.Time{} }
func (*typedNilFileInfo) IsDir() bool        { panic("typed nil dereference") }
func (*typedNilFileInfo) Sys() any           { return nil }

type runtimeTrustSpy struct {
	proof os.FileInfo
	err   error
	calls int
	id    workspaceid.WorkspaceID
	root  string
}

func (spy *runtimeTrustSpy) TrustedRootIdentity(id workspaceid.WorkspaceID, root string) (os.FileInfo, error) {
	spy.calls++
	spy.id, spy.root = id, root
	return spy.proof, spy.err
}

type runtimeConfigSpy struct {
	config settings.Config
	err    error
	calls  int
}

func (spy *runtimeConfigSpy) Load() (settings.Config, error) {
	spy.calls++
	return spy.config, spy.err
}

type runtimeCredentialSpy struct{ calls int }

func (spy *runtimeCredentialSpy) Get(context.Context, string) ([]byte, error) {
	spy.calls++
	return []byte("secret"), nil
}

func runtimeWorkspace(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "wiki"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("# workspace"), 0o600); err != nil {
		t.Fatal(err)
	}
	return filepath.Clean(root)
}
