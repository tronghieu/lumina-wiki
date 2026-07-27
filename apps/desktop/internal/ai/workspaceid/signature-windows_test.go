//go:build windows

package workspaceid

import (
	"encoding/hex"
	"os"
	"strings"
	"testing"
)

func TestWindowsWorkspaceSignatureUsesFullFileIDInfo(t *testing.T) {
	root := t.TempDir()
	handle, err := os.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()

	first, available, err := platformHandleSignature(handle)
	if err != nil {
		t.Fatal(err)
	}
	if !available {
		t.Fatal("Windows FileIdInfo was unavailable")
	}
	parts := strings.Split(string(first), ":")
	if len(parts) != 3 || parts[0] != "windows-v1" || len(parts[2]) != 32 {
		t.Fatalf("workspace signature does not contain a 128-bit file ID")
	}
	decoded, err := hex.DecodeString(parts[2])
	if err != nil || len(decoded) != 16 {
		t.Fatalf("workspace file ID is not 128-bit")
	}

	second, available, err := platformHandleSignature(handle)
	if err != nil || !available || second != first {
		t.Fatalf("workspace FileIdInfo was not stable for one open handle")
	}
}
