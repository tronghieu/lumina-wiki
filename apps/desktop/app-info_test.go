package main

import "testing"

func TestAppInfo(t *testing.T) {
	info := appInfo()
	if info.Name != "Lumina Wiki" {
		t.Fatalf("unexpected app name: %q", info.Name)
	}
	if info.Description == "" {
		t.Fatal("description must be set")
	}
}
