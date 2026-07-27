package ai

import (
	"context"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type wailsAppWindowLookup struct {
	manager *application.WindowManager
}

func (lookup *wailsAppWindowLookup) WindowByID(id uint) (application.Window, bool) {
	if lookup == nil || lookup.manager == nil {
		return nil, false
	}
	return lookup.manager.GetByID(id)
}

type wailsDialogDriver struct {
	manager   *application.DialogManager
	questions messageDialogFactory
	ownership questionOwnershipPolicy
}

type messageDialogPresenter interface {
	Show()
}

type messageDialogFactory interface {
	NewQuestion(NativeQuestionSpec, func(), func()) messageDialogPresenter
}

type questionOwnershipPolicy interface {
	AllowQuestion(application.Window) bool
}

func newWailsDialogDriver(manager *application.DialogManager, windows *application.WindowManager) *wailsDialogDriver {
	return &wailsDialogDriver{
		manager: manager, questions: &wailsMessageDialogFactory{manager: manager},
		ownership: newQuestionOwnershipPolicy(&wailsWindowCollection{manager: windows}),
	}
}

func newWailsDialogDriverForTest(factory messageDialogFactory, ownership questionOwnershipPolicy) *wailsDialogDriver {
	return &wailsDialogDriver{questions: factory, ownership: ownership}
}

func (driver *wailsDialogDriver) ChooseDirectory(ctx context.Context, spec DirectoryDialogSpec) (string, error) {
	if driver == nil || driver.manager == nil || ctx == nil || ctx.Err() != nil || !hasValue(spec.Window) {
		return "", ErrNativeAuthority
	}
	selection, err := driver.manager.OpenFile().
		CanChooseDirectories(spec.CanChooseDirectories).
		CanChooseFiles(spec.CanChooseFiles).
		AttachToWindow(spec.Window).
		PromptForSingleSelection()
	if err != nil || ctx.Err() != nil {
		return "", ErrNativeAuthority
	}
	return selection, nil
}

func (driver *wailsDialogDriver) Ask(ctx context.Context, spec NativeQuestionSpec) (bool, error) {
	if driver == nil || !hasValue(driver.questions) || !hasValue(driver.ownership) || ctx == nil || ctx.Err() != nil || !hasValue(spec.Window) {
		return false, ErrNativeAuthority
	}
	if !driver.ownership.AllowQuestion(spec.Window) {
		return false, ErrNativeAuthority
	}
	result := make(chan bool, 1)
	var resolveOnce sync.Once
	resolve := func(approved bool) {
		resolveOnce.Do(func() { result <- approved })
	}
	dialog := driver.questions.NewQuestion(spec, func() { resolve(true) }, func() { resolve(false) })
	if !hasValue(dialog) {
		return false, ErrNativeAuthority
	}
	dialog.Show()
	select {
	case approved := <-result:
		if ctx.Err() != nil {
			return false, ErrNativeAuthority
		}
		return approved, nil
	case <-ctx.Done():
		return false, ErrNativeAuthority
	}
}
