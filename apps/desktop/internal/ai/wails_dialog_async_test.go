package ai

import (
	"context"
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type messageDialogPresenterStub struct {
	show func()
}

func (stub *messageDialogPresenterStub) Show() { stub.show() }

type messageDialogFactoryStub struct {
	builds int
	build  func(approve, cancel func()) messageDialogPresenter
}

func (stub *messageDialogFactoryStub) NewQuestion(_ NativeQuestionSpec, approve, cancel func()) messageDialogPresenter {
	stub.builds++
	return stub.build(approve, cancel)
}

type questionOwnershipStub struct {
	allowed bool
}

func (stub questionOwnershipStub) AllowQuestion(application.Window) bool { return stub.allowed }

type askResult struct {
	approved bool
	err      error
}

func TestWailsDialogAskWaitsForAsynchronousApproveOrCancel(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "async-question"})
	for name, want := range map[string]bool{"approve": true, "cancel": false} {
		t.Run(name, func(t *testing.T) {
			shown := make(chan struct{})
			var approve, cancel func()
			factory := &messageDialogFactoryStub{build: func(onApprove, onCancel func()) messageDialogPresenter {
				approve, cancel = onApprove, onCancel
				return &messageDialogPresenterStub{show: func() { close(shown) }}
			}}
			driver := newWailsDialogDriverForTest(factory, questionOwnershipStub{allowed: true})
			result := make(chan askResult, 1)
			go func() {
				approved, err := driver.Ask(context.Background(), NativeQuestionSpec{Window: window})
				result <- askResult{approved, err}
			}()
			<-shown
			select {
			case early := <-result:
				t.Fatalf("returned before callback: %#v", early)
			default:
			}
			if want {
				approve()
			} else {
				cancel()
			}
			got := <-result
			if got.err != nil || got.approved != want {
				t.Fatalf("result=%#v", got)
			}
		})
	}
}

func TestWailsDialogAskHandlesSynchronousAndDuplicateCallbacks(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "sync-question"})
	factory := &messageDialogFactoryStub{build: func(approve, cancel func()) messageDialogPresenter {
		return &messageDialogPresenterStub{show: func() {
			approve()
			cancel()
			approve()
		}}
	}}
	driver := newWailsDialogDriverForTest(factory, questionOwnershipStub{allowed: true})
	approved, err := driver.Ask(context.Background(), NativeQuestionSpec{Window: window})
	if err != nil || !approved {
		t.Fatalf("approved=%v err=%v", approved, err)
	}
}

func TestWailsDialogAskCancellationReturnsWithoutCallback(t *testing.T) {
	window := application.NewWindow(application.WebviewWindowOptions{Name: "cancel-question"})
	shown := make(chan struct{})
	var lateApprove func()
	factory := &messageDialogFactoryStub{build: func(approve, _ func()) messageDialogPresenter {
		lateApprove = approve
		return &messageDialogPresenterStub{show: func() { close(shown) }}
	}}
	driver := newWailsDialogDriverForTest(factory, questionOwnershipStub{allowed: true})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, err := driver.Ask(ctx, NativeQuestionSpec{Window: window}); result <- err }()
	<-shown
	cancel()
	if err := <-result; !errors.Is(err, ErrNativeAuthority) {
		t.Fatalf("err=%v", err)
	}
	done := make(chan struct{})
	go func() { lateApprove(); lateApprove(); close(done) }()
	<-done
}

func TestQuestionOwnershipPolicyFailsClosedBeforeShow(t *testing.T) {
	one := application.NewWindow(application.WebviewWindowOptions{Name: "owner-one"})
	two := application.NewWindow(application.WebviewWindowOptions{Name: "owner-two"})
	if !linuxQuestionOwnerAllowed([]application.Window{one}, one) ||
		linuxQuestionOwnerAllowed(nil, one) ||
		linuxQuestionOwnerAllowed([]application.Window{one, two}, one) ||
		linuxQuestionOwnerAllowed([]application.Window{one}, two) {
		t.Fatal("linux one-window ownership policy mismatch")
	}
	factory := &messageDialogFactoryStub{build: func(_, _ func()) messageDialogPresenter {
		return &messageDialogPresenterStub{show: func() { t.Fatal("dialog shown") }}
	}}
	driver := newWailsDialogDriverForTest(factory, questionOwnershipStub{allowed: false})
	if _, err := driver.Ask(context.Background(), NativeQuestionSpec{Window: one}); !errors.Is(err, ErrNativeAuthority) {
		t.Fatalf("err=%v", err)
	}
	if factory.builds != 0 {
		t.Fatalf("dialogs built=%d", factory.builds)
	}
}
