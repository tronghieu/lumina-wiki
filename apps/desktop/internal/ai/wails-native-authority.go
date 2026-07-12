package ai

import (
	"context"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/session"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/ai/workspaceid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DirectoryDialogSpec struct {
	Window                  application.Window
	CanChooseDirectories    bool
	CanChooseFiles          bool
	AllowsMultipleSelection bool
}

type NativeQuestionSpec struct {
	Window       application.Window
	Title        string
	Message      string
	ApproveLabel string
	CancelLabel  string
}

type wailsWindowLookup interface {
	WindowByID(uint) (application.Window, bool)
}

type nativeDialogDriver interface {
	ChooseDirectory(context.Context, DirectoryDialogSpec) (string, error)
	Ask(context.Context, NativeQuestionSpec) (bool, error)
}

type WailsNativeAuthority struct {
	windows wailsWindowLookup
	dialogs nativeDialogDriver
}

func NewWailsNativeAuthority(app *application.App) (*WailsNativeAuthority, error) {
	if app == nil || app.Window == nil || app.Dialog == nil {
		return nil, ErrInvalidInput
	}
	return newWailsNativeAuthority(
		&wailsAppWindowLookup{manager: app.Window},
		newWailsDialogDriver(app.Dialog, app.Window),
	)
}

func newWailsNativeAuthority(windows wailsWindowLookup, dialogs nativeDialogDriver) (*WailsNativeAuthority, error) {
	if !hasValue(windows) || !hasValue(dialogs) {
		return nil, ErrInvalidInput
	}
	return &WailsNativeAuthority{windows: windows, dialogs: dialogs}, nil
}

func (authority *WailsNativeAuthority) ChooseDirectory(ctx context.Context, windowID session.WindowID) (DirectorySelection, error) {
	window, err := authority.window(ctx, windowID)
	if err != nil {
		return DirectorySelection{}, err
	}
	selected, err := authority.dialogs.ChooseDirectory(ctx, DirectoryDialogSpec{
		Window: window, CanChooseDirectories: true, CanChooseFiles: false, AllowsMultipleSelection: false,
	})
	if err != nil || ctx.Err() != nil {
		return DirectorySelection{}, ErrNativeAuthority
	}
	if selected == "" {
		return DirectorySelection{Approved: false}, nil
	}
	return DirectorySelection{Path: selected, Approved: true}, nil
}

func (authority *WailsNativeAuthority) ConfirmDirectory(ctx context.Context, windowID session.WindowID, _ string) (bool, error) {
	return authority.ask(ctx, windowID, NativeQuestionSpec{
		Title:        "Open Lumina workspace?",
		Message:      "Allow Lumina to validate and open this workspace folder?",
		ApproveLabel: "Open Workspace",
		CancelLabel:  "Cancel",
	})
}

func (authority *WailsNativeAuthority) ConfirmAttachDecision(ctx context.Context, windowID session.WindowID, kind workspaceid.AttachKind) (bool, error) {
	title, message, ok := attachDecisionPrompt(kind)
	if !ok {
		return false, ErrNativeAuthority
	}
	return authority.ask(ctx, windowID, NativeQuestionSpec{
		Title: title, Message: message, ApproveLabel: "Continue", CancelLabel: "Cancel",
	})
}

func (authority *WailsNativeAuthority) ask(ctx context.Context, windowID session.WindowID, question NativeQuestionSpec) (bool, error) {
	window, err := authority.window(ctx, windowID)
	if err != nil {
		return false, err
	}
	question.Window = window
	approved, err := authority.dialogs.Ask(ctx, question)
	if err != nil || ctx.Err() != nil {
		return false, ErrNativeAuthority
	}
	return approved, nil
}

func (authority *WailsNativeAuthority) window(ctx context.Context, id session.WindowID) (application.Window, error) {
	if authority == nil || !hasValue(authority.windows) || !hasValue(authority.dialogs) || ctx == nil || ctx.Err() != nil || id == 0 {
		return nil, ErrNativeAuthority
	}
	nativeID := uint(id)
	if session.WindowID(nativeID) != id {
		return nil, ErrNativeAuthority
	}
	window, ok := authority.windows.WindowByID(nativeID)
	if !ok || !hasValue(window) || window.ID() != nativeID {
		return nil, ErrNativeAuthority
	}
	return window, nil
}

func attachDecisionPrompt(kind workspaceid.AttachKind) (string, string, bool) {
	switch kind {
	case workspaceid.AttachIdentityConfirmationRequired:
		return "Confirm workspace identity", "This folder identity differs from the saved workspace. Continue?", true
	case workspaceid.AttachRenameConfirmationRequired:
		return "Confirm moved workspace", "This workspace appears to have moved or been renamed. Update its saved location?", true
	case workspaceid.AttachPathReuseConfirmationRequired:
		return "Confirm reused location", "This location appears to contain a different workspace. Continue with the current workspace?", true
	case workspaceid.AttachAmbiguousConfirmationRequired:
		return "Confirm workspace match", "This folder may match more than one saved workspace. Continue with a new identity?", true
	default:
		return "", "", false
	}
}
