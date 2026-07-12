package ai

import (
	"context"
	"errors"
	"sync"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
)

var testWorkspaceID = workspaceid.WorkspaceID("ws_0123456789abcdef0123456789abcdef")

type callLog struct {
	mu    sync.Mutex
	calls []string
}

func (log *callLog) add(call string) {
	log.mu.Lock()
	defer log.mu.Unlock()
	log.calls = append(log.calls, call)
}

func (log *callLog) snapshot() []string {
	log.mu.Lock()
	defer log.mu.Unlock()
	return append([]string(nil), log.calls...)
}

type windowResolverStub struct {
	log    *callLog
	window session.WindowID
	err    error
}

func (stub *windowResolverStub) ResolveWindow(context.Context) (session.WindowID, error) {
	stub.log.add("window")
	return stub.window, stub.err
}

type nativeAuthorityStub struct {
	log             *callLog
	selection       DirectorySelection
	chooseErr       error
	directoryOK     bool
	directoryErr    error
	attachDecision  bool
	attachPromptErr error
}

func (stub *nativeAuthorityStub) ChooseDirectory(context.Context, session.WindowID) (DirectorySelection, error) {
	stub.log.add("choose")
	return stub.selection, stub.chooseErr
}

func (stub *nativeAuthorityStub) ConfirmDirectory(context.Context, session.WindowID, string) (bool, error) {
	stub.log.add("confirm-directory")
	return stub.directoryOK, stub.directoryErr
}

func (stub *nativeAuthorityStub) ConfirmAttachDecision(context.Context, session.WindowID, workspaceid.AttachKind) (bool, error) {
	stub.log.add("confirm-decision")
	return stub.attachDecision, stub.attachPromptErr
}

type validatorStub struct {
	log    *callLog
	result WorkspaceShape
	err    error
}

func (stub *validatorStub) Validate(context.Context, string) (WorkspaceShape, error) {
	stub.log.add("validate")
	return stub.result, stub.err
}

type attacherStub struct {
	log        *callLog
	decision   workspaceid.AttachDecision
	beginErr   error
	confirmID  workspaceid.WorkspaceID
	confirmErr error
	cancelErr  error
}

func (stub *attacherStub) BeginAttach(root string) (workspaceid.AttachDecision, error) {
	stub.log.add("begin-attach")
	return stub.decision, stub.beginErr
}

func (stub *attacherStub) ConfirmAttach(string) (workspaceid.WorkspaceID, error) {
	stub.log.add("confirm-attach")
	return stub.confirmID, stub.confirmErr
}

func (stub *attacherStub) CancelAttach(string) error {
	stub.log.add("cancel-attach")
	return stub.cancelErr
}

type runtimeSpy struct {
	mu     sync.Mutex
	closes int
}

func (runtime *runtimeSpy) Close() error {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	runtime.closes++
	return nil
}

func (runtime *runtimeSpy) closeCount() int {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	return runtime.closes
}

type runtimeFactoryStub struct {
	log        *callLog
	runtime    session.Runtime
	err        error
	loadedID   workspaceid.WorkspaceID
	loadedRoot string
}

func (stub *runtimeFactoryStub) Load(_ context.Context, id workspaceid.WorkspaceID, root string) (session.Runtime, error) {
	stub.log.add("runtime")
	stub.loadedID, stub.loadedRoot = id, root
	return stub.runtime, stub.err
}

type registryStub struct {
	log            *callLog
	capability     session.Capability
	activateErr    error
	deactivateErr  error
	cancelErr      error
	closeWindowErr error
	closeErr       error
	display        session.DisplayMetadata
}

func (stub *registryStub) Activate(_ session.WindowID, _ workspaceid.WorkspaceID, display session.DisplayMetadata, _ session.Runtime) (session.Capability, error) {
	stub.log.add("activate")
	stub.display = display
	return stub.capability, stub.activateErr
}

func (stub *registryStub) Deactivate(session.WindowID, session.Reference) error {
	stub.log.add("deactivate")
	return stub.deactivateErr
}

func (stub *registryStub) BeginRequest(context.Context, session.WindowID, session.Reference, string) (context.Context, *session.RequestLease, error) {
	stub.log.add("begin-request")
	return nil, nil, session.ErrInvalidSession
}

func (stub *registryStub) Resolve(session.WindowID, session.Reference) (*session.RuntimeLease, error) {
	stub.log.add("resolve")
	return nil, session.ErrInvalidSession
}

func (stub *registryStub) CancelRequest(session.WindowID, session.Reference, string) error {
	stub.log.add("cancel-request")
	return stub.cancelErr
}

func (stub *registryStub) CloseWindow(session.WindowID) error {
	stub.log.add("close-window")
	return stub.closeWindowErr
}
func (stub *registryStub) Close() error { stub.log.add("close"); return stub.closeErr }

func validDecision(kind workspaceid.AttachKind) workspaceid.AttachDecision {
	return workspaceid.AttachDecision{Kind: kind, Token: "opaque-token", CanonicalPath: "/safe/Nghiên cứu"}
}

func newTestService(log *callLog) (*Service, *nativeAuthorityStub, *validatorStub, *attacherStub, *runtimeFactoryStub, *registryStub) {
	authority := &nativeAuthorityStub{log: log, selection: DirectorySelection{Path: "/private/chosen-root", Approved: true}, directoryOK: true, attachDecision: true}
	validator := &validatorStub{log: log, result: WorkspaceShape{Valid: true}}
	attacher := &attacherStub{log: log, decision: validDecision(workspaceid.AttachKnown), confirmID: testWorkspaceID}
	factory := &runtimeFactoryStub{log: log, runtime: &runtimeSpy{}}
	registry := &registryStub{log: log, capability: session.Capability{SessionID: session.SessionID("sess_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), WorkspaceID: testWorkspaceID, Generation: 1, Display: session.DisplayMetadata{Label: "Nghiên cứu"}}}
	settingsStore, credentials := defaultFacadeRepositories()
	service, err := NewService(Dependencies{Windows: &windowResolverStub{log: log, window: 7}, Native: authority, Validator: validator, Attacher: attacher, Runtimes: factory, Sessions: registry, Streams: streamSinkFactoryStub{}, Settings: settingsStore, Credentials: credentials})
	if err != nil {
		panic(err)
	}
	return service, authority, validator, attacher, factory, registry
}

var errStub = errors.New("sensitive /private/root cause")
