package ai

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type windowLookupStub struct {
	windows map[uint]application.Window
}

func (stub *windowLookupStub) WindowByID(id uint) (application.Window, bool) {
	window, ok := stub.windows[id]
	return window, ok
}

type nativeDialogDriverStub struct {
	directory      string
	directoryErr   error
	directoryCalls []DirectoryDialogSpec
	answer         bool
	questionErr    error
	questions      []NativeQuestionSpec
}

func (stub *nativeDialogDriverStub) ChooseDirectory(_ context.Context, spec DirectoryDialogSpec) (string, error) {
	stub.directoryCalls = append(stub.directoryCalls, spec)
	return stub.directory, stub.directoryErr
}

func (stub *nativeDialogDriverStub) Ask(_ context.Context, spec NativeQuestionSpec) (bool, error) {
	stub.questions = append(stub.questions, spec)
	return stub.answer, stub.questionErr
}

func TestWailsNativeChooseDirectoryIsOwnedAndDirectoryOnly(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "native-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{directory: "/trusted/chosen"}
	authority, err := newWailsNativeAuthority(lookup, driver)
	if err != nil {
		t.Fatal(err)
	}
	selection, err := authority.ChooseDirectory(context.Background(), session.WindowID(window.ID()))
	if err != nil || !selection.Approved || selection.Path != "/trusted/chosen" {
		t.Fatalf("selection=%#v err=%v", selection, err)
	}
	if len(driver.directoryCalls) != 1 {
		t.Fatalf("calls=%d", len(driver.directoryCalls))
	}
	spec := driver.directoryCalls[0]
	if spec.Window != window || !spec.CanChooseDirectories || spec.CanChooseFiles || spec.AllowsMultipleSelection {
		t.Fatalf("spec=%#v", spec)
	}
	driver.directory = ""
	selection, err = authority.ChooseDirectory(context.Background(), session.WindowID(window.ID()))
	if err != nil || selection.Approved || selection.Path != "" {
		t.Fatalf("cancel=%#v err=%v", selection, err)
	}
}

func TestWailsNativeConfirmationPromptsNeverContainCallerPath(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "question-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	approved, err := authority.ConfirmDirectory(context.Background(), session.WindowID(window.ID()), "/private/caller-root")
	if err != nil || !approved || len(driver.questions) != 1 {
		t.Fatalf("approved=%v err=%v", approved, err)
	}
	question := driver.questions[0]
	if question.Window != window || question.Title == "" || question.Message == "" || strings.Contains(question.Message, "/private") {
		t.Fatalf("question=%#v", question)
	}
}

func TestWailsNativeResetRecentActivityPromptStatesPreservedData(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "reset-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)

	approved, err := authority.ConfirmResetRecentActivity(
		context.Background(), session.WindowID(window.ID()),
	)
	if err != nil || !approved || len(driver.questions) != 1 {
		t.Fatalf("approved=%v err=%v questions=%d", approved, err, len(driver.questions))
	}
	question := driver.questions[0]
	if question.Window != window ||
		!strings.Contains(question.Message, "Library content") ||
		!strings.Contains(question.Message, "workspace identities") {
		t.Fatalf("question=%#v", question)
	}
}

func TestWailsNativeCreatePromptsShowExactDestinationAndDistinctEmptyApproval(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "create-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	destination := filepath.Join(t.TempDir(), "Lumina Library")

	approved, err := authority.ConfirmCreateDestination(
		context.Background(),
		session.WindowID(window.ID()),
		destination,
	)
	if err != nil || !approved {
		t.Fatalf("create approved=%v err=%v", approved, err)
	}
	approved, err = authority.ConfirmUseEmptyDirectory(
		context.Background(),
		session.WindowID(window.ID()),
		destination,
	)
	if err != nil || !approved {
		t.Fatalf("empty approved=%v err=%v", approved, err)
	}
	if len(driver.questions) != 2 {
		t.Fatalf("questions=%d", len(driver.questions))
	}
	create, empty := driver.questions[0], driver.questions[1]
	if create.Window != window || !strings.Contains(create.Message, destination) ||
		create.ApproveLabel != "Create Library" || create.CancelLabel != "Change Location" {
		t.Fatalf("create question=%#v", create)
	}
	if empty.Window != window || !strings.Contains(empty.Message, destination) ||
		empty.ApproveLabel != "Use This Empty Folder" || empty.CancelLabel != "Cancel" ||
		empty.Title == create.Title {
		t.Fatalf("empty question=%#v", empty)
	}
}

func TestWailsNativeCreatePromptsRejectUnsafeDestinationBeforeDialog(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "create-invalid"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	for _, destination := range []string{"relative", "/safe/\nspoof", strings.Repeat("x", MaxTypedRootBytes+1)} {
		if _, err := authority.ConfirmCreateDestination(
			context.Background(),
			session.WindowID(window.ID()),
			destination,
		); !errors.Is(err, ErrNativeAuthority) {
			t.Fatalf("destination %q err=%v", destination, err)
		}
	}
	if len(driver.questions) != 0 {
		t.Fatalf("unsafe destination prompted: %v", driver.questions)
	}
}

func TestWailsNativeEmbeddingDisclosurePromptIsOwnedAndSafe(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "consent-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	disclosure := EmbeddingDisclosure{ProfileID: "embed-main", ProviderLabel: "Local embeddings", ProviderKind: "ollama",
		Model: "nomic-embed", EndpointOrigin: "http://127.0.0.1:11434", Kind: "local_cpu_disk", DisclosureVersion: 1}
	approved, err := authority.ConfirmEmbeddingDisclosure(context.Background(), session.WindowID(window.ID()), disclosure)
	if err != nil || !approved || len(driver.questions) != 1 {
		t.Fatalf("approved=%v err=%v questions=%d", approved, err, len(driver.questions))
	}
	question := driver.questions[0]
	if question.Window != window || !strings.Contains(question.Message, "local_cpu_disk") || !strings.Contains(question.Message, disclosure.EndpointOrigin) || strings.Contains(question.Message, "credential") || strings.Contains(question.Message, "token") {
		t.Fatalf("question=%#v", question)
	}
}

func TestWailsNativeRejectsInvalidEmbeddingDisclosure(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "consent-invalid"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	invalid := EmbeddingDisclosure{ProfileID: "embed-main", ProviderLabel: "Provider", ProviderKind: "ollama", Model: "model",
		EndpointOrigin: "http://user:secret@127.0.0.1/private", Kind: "local_cpu_disk", DisclosureVersion: 1}
	if _, err := authority.ConfirmEmbeddingDisclosure(context.Background(), session.WindowID(window.ID()), invalid); !errors.Is(err, ErrNativeAuthority) {
		t.Fatalf("err=%v", err)
	}
	if len(driver.questions) != 0 {
		t.Fatal("invalid disclosure prompted")
	}
	invalid = EmbeddingDisclosure{ProfileID: "embed-main", ProviderLabel: "safe\u202eevil", ProviderKind: "ollama", Model: "model",
		EndpointOrigin: "http://127.0.0.1:11434", Kind: "local_cpu_disk", DisclosureVersion: 1}
	if _, err := authority.ConfirmEmbeddingDisclosure(context.Background(), session.WindowID(window.ID()), invalid); !errors.Is(err, ErrNativeAuthority) {
		t.Fatalf("bidi err=%v", err)
	}
	if len(driver.questions) != 0 {
		t.Fatal("bidi disclosure prompted")
	}
}

func TestWailsNativeMapsOnlySensitiveAttachKindsToStablePrompts(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "decision-owner"})
	lookup := &windowLookupStub{windows: map[uint]application.Window{window.ID(): window}}
	driver := &nativeDialogDriverStub{answer: true}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	kinds := []workspaceid.AttachKind{
		workspaceid.AttachIdentityConfirmationRequired,
		workspaceid.AttachRenameConfirmationRequired,
		workspaceid.AttachPathReuseConfirmationRequired,
		workspaceid.AttachAmbiguousConfirmationRequired,
	}
	for _, kind := range kinds {
		approved, err := authority.ConfirmAttachDecision(context.Background(), session.WindowID(window.ID()), kind)
		if err != nil || !approved {
			t.Fatalf("kind=%s approved=%v err=%v", kind, approved, err)
		}
	}
	if len(driver.questions) != len(kinds) {
		t.Fatalf("questions=%d", len(driver.questions))
	}
	for _, question := range driver.questions {
		if question.Title == "" || question.Message == "" || strings.Contains(question.Message, "token") {
			t.Fatalf("question=%#v", question)
		}
	}
	for _, kind := range []workspaceid.AttachKind{workspaceid.AttachNew, workspaceid.AttachKnown} {
		if _, err := authority.ConfirmAttachDecision(context.Background(), session.WindowID(window.ID()), kind); !errors.Is(err, ErrNativeAuthority) {
			t.Fatalf("kind=%s err=%v", kind, err)
		}
	}
	if len(driver.questions) != len(kinds) {
		t.Fatal("new/known opened a confirmation")
	}
}

func TestWailsNativeRejectsMissingWindowCancellationAndTypedNilConstructors(t *testing.T) {
	lookup := &windowLookupStub{windows: map[uint]application.Window{}}
	driver := &nativeDialogDriverStub{directoryErr: errStub}
	authority, _ := newWailsNativeAuthority(lookup, driver)
	if _, err := authority.ChooseDirectory(context.Background(), 99); !errors.Is(err, ErrNativeAuthority) || strings.Contains(err.Error(), "/private") {
		t.Fatalf("missing window=%v", err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := authority.ChooseDirectory(cancelled, 99); !errors.Is(err, ErrNativeAuthority) || len(driver.directoryCalls) != 0 {
		t.Fatalf("cancelled=%v calls=%d", err, len(driver.directoryCalls))
	}
	var nilLookup *windowLookupStub
	if _, err := newWailsNativeAuthority(nilLookup, driver); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("lookup=%v", err)
	}
	var nilDriver *nativeDialogDriverStub
	if _, err := newWailsNativeAuthority(lookup, nilDriver); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("driver=%v", err)
	}
	var nilApp *application.App
	if _, err := NewWailsNativeAuthority(nilApp); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("app=%v", err)
	}
}
