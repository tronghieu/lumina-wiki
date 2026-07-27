package session

import (
	"errors"
	"testing"
)

func TestAccessModeValidation(t *testing.T) {
	for name, mode := range map[string]AccessMode{
		"read only": AccessReadOnly,
		"writable":  AccessWritable,
	} {
		t.Run(name, func(t *testing.T) {
			if !mode.Valid() {
				t.Fatalf("%q should be valid", mode)
			}
		})
	}
	for _, mode := range []AccessMode{"", "read_only", "write", "READ-ONLY"} {
		if mode.Valid() {
			t.Fatalf("%q should be invalid", mode)
		}
	}
}

func TestActivateDescriptorCarriesBackendAccessMode(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	writableRuntime := &runtimeSpy{}
	writable, err := registry.ActivateDescriptor(SessionDescriptor{
		WindowID:    1,
		WorkspaceID: testWorkspaceID,
		Display:     DisplayMetadata{Label: "Writable"},
		AccessMode:  AccessWritable,
		Runtime:     writableRuntime,
		RootLease:   &trustedRootLeaseSpy{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if writable.AccessMode != AccessWritable {
		t.Fatalf("capability mode=%q", writable.AccessMode)
	}
	lease, err := registry.Resolve(1, writable.Reference())
	if err != nil {
		t.Fatal(err)
	}
	if lease.AccessMode() != AccessWritable {
		t.Fatalf("lease mode=%q", lease.AccessMode())
	}
	lease.Finish()

	readOnly, err := registry.Activate(2, testWorkspaceID, DisplayMetadata{Label: "Existing"}, &runtimeSpy{})
	if err != nil {
		t.Fatal(err)
	}
	if readOnly.AccessMode != AccessReadOnly {
		t.Fatalf("legacy activation mode=%q", readOnly.AccessMode)
	}
}

func TestInvalidAccessModeRollsBackWithoutReplacingSession(t *testing.T) {
	registry := NewRegistry(Options{Random: entropy(1, 2)})
	active := activate(t, registry, 1, &runtimeSpy{})
	for _, mode := range []AccessMode{"", "owner"} {
		incoming := &runtimeSpy{}
		_, err := registry.ActivateDescriptor(SessionDescriptor{
			WindowID:    1,
			WorkspaceID: testWorkspaceID,
			Display:     DisplayMetadata{Label: "Invalid"},
			AccessMode:  mode,
			Runtime:     incoming,
			RootLease:   &trustedRootLeaseSpy{},
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("mode=%q err=%v", mode, err)
		}
		if incoming.closeCount() != 1 {
			t.Fatalf("mode=%q incoming closes=%d", mode, incoming.closeCount())
		}
	}
	lease, err := registry.Resolve(1, active.Reference())
	if err != nil {
		t.Fatalf("active session was replaced: %v", err)
	}
	lease.Finish()
	next := activate(t, registry, 2, &runtimeSpy{})
	if next.Generation != active.Generation+1 {
		t.Fatalf("invalid descriptor consumed generation: active=%d next=%d", active.Generation, next.Generation)
	}
}
