package ai

import "github.com/wailsapp/wails/v3/pkg/application"

type wailsMessageDialogFactory struct {
	manager *application.DialogManager
}

func (factory *wailsMessageDialogFactory) NewQuestion(spec NativeQuestionSpec, approveCallback, cancelCallback func()) messageDialogPresenter {
	if factory == nil || factory.manager == nil {
		return nil
	}
	dialog := factory.manager.Question().
		SetTitle(spec.Title).
		SetMessage(spec.Message).
		AttachToWindow(spec.Window)
	approve := dialog.AddButton(spec.ApproveLabel).OnClick(approveCallback)
	cancel := dialog.AddButton(spec.CancelLabel).OnClick(cancelCallback)
	dialog.SetDefaultButton(approve)
	dialog.SetCancelButton(cancel)
	return dialog
}

type wailsWindowCollection struct {
	manager *application.WindowManager
}

func (collection *wailsWindowCollection) Windows() []application.Window {
	if collection == nil || collection.manager == nil {
		return nil
	}
	return collection.manager.GetAll()
}

type questionWindowCollection interface {
	Windows() []application.Window
}

func linuxQuestionOwnerAllowed(windows []application.Window, requested application.Window) bool {
	return len(windows) == 1 && sameQuestionWindow(windows[0], requested)
}

func questionWindowPresent(windows []application.Window, requested application.Window) bool {
	for _, window := range windows {
		if sameQuestionWindow(window, requested) {
			return true
		}
	}
	return false
}

func sameQuestionWindow(left, right application.Window) bool {
	return hasValue(left) && hasValue(right) && left.ID() != 0 && left.ID() == right.ID()
}
