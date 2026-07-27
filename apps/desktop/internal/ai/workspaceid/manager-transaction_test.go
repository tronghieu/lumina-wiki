package workspaceid

import (
	"errors"
	"os"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

func TestBeginAttachTrustedRejectsMismatchedProof(t *testing.T) {
	now := time.Now().UTC()
	signatures := map[string]Signature{}
	manager := testManager(t, t.TempDir(), &now, signatures)
	root := makeWorkspace(t)
	other := makeWorkspace(t)
	proof, err := rootproof.Open(other)
	if err != nil {
		t.Fatal(err)
	}
	defer proof.Close()

	if prepared, _, err := manager.BeginAttachTrusted(root, proof); err == nil {
		_ = prepared.Abort()
		t.Fatal("mismatched root proof was accepted")
	}
	registry, err := manager.store.Load()
	if err != nil || len(registry.Records) != 0 {
		t.Fatalf("mismatch mutated registry: %#v, %v", registry, err)
	}
}

func TestPreparedAttachAbortLeavesRegistryUnchanged(t *testing.T) {
	now := time.Now().UTC()
	signatures := map[string]Signature{}
	manager := testManager(t, t.TempDir(), &now, signatures)
	root := makeWorkspace(t)
	signatures[root] = "signature"
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer proof.Close()

	prepared, decision, err := manager.BeginAttachTrusted(root, proof)
	if err != nil {
		t.Fatal(err)
	}
	if decision.Kind != AttachNew || !prepared.WorkspaceID().Valid() {
		t.Fatalf("prepared = %#v, decision = %#v", prepared, decision)
	}
	if err := prepared.Approve(decision.Token); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Abort(); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Abort(); err != nil {
		t.Fatalf("copy-safe abort = %v", err)
	}
	registry, err := manager.store.Load()
	if err != nil || len(registry.Records) != 0 {
		t.Fatalf("abort mutated registry: %#v, %v", registry, err)
	}
	if err := prepared.Commit(); !errors.Is(err, ErrPreparedAttach) {
		t.Fatalf("commit after abort = %v", err)
	}
}

func TestPreparedAttachApprovalIsSingleUseAndCommitPreservesProvisionalID(t *testing.T) {
	now := time.Now().UTC()
	signatures := map[string]Signature{}
	manager := testManager(t, t.TempDir(), &now, signatures)
	root := makeWorkspace(t)
	signatures[root] = "signature"
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer proof.Close()

	prepared, decision, err := manager.BeginAttachTrusted(root, proof)
	if err != nil {
		t.Fatal(err)
	}
	id := prepared.WorkspaceID()
	if err := prepared.Commit(); !errors.Is(err, ErrPreparedAttach) {
		t.Fatalf("commit before approval = %v", err)
	}
	if err := prepared.Approve(decision.Token); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Approve(decision.Token); !errors.Is(err, ErrInvalidDecisionToken) {
		t.Fatalf("reused approval = %v", err)
	}
	lease, err := prepared.TakeRootLease()
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	if info, err := lease.Stat("."); err != nil || !info.IsDir() {
		t.Fatalf("trusted lease = %#v, %v", info, err)
	}
	if err := prepared.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := prepared.Commit(); err != nil {
		t.Fatalf("idempotent commit = %v", err)
	}
	registry, err := manager.store.Load()
	if err != nil || len(registry.Records) != 1 || registry.Records[0].WorkspaceID != id {
		t.Fatalf("committed registry = %#v, %v; want %q", registry, err, id)
	}
	if _, err := prepared.TakeRootLease(); !errors.Is(err, ErrPreparedAttach) {
		t.Fatalf("second lease transfer = %v", err)
	}
}

func TestLegacySignatureMatchMigratesRecordWithoutChangingID(t *testing.T) {
	path := absoluteTestPath("legacy")
	id := WorkspaceID("ws_11111111111111111111111111111111")
	registry := Registry{SchemaVersion: CurrentSchemaVersion, Records: []Record{{
		SchemaVersion: CurrentSchemaVersion, WorkspaceID: id, CanonicalPath: path,
		FilesystemSignature: "windows:12:3400000056", FirstSeenAt: time.Now(), LastSeenAt: time.Now(), Active: true,
	}}}
	candidate := Candidate{CanonicalPath: path + "-moved",
		Signature: "windows-v1:12:00112233445566778899aabbccddeeff", HasSignature: true}
	kind, index := classifyCandidate(registry, candidate, "windows:12:3400000056")
	if kind != AttachRenameConfirmationRequired || index != 0 {
		t.Fatalf("legacy migration classification = %s/%d", kind, index)
	}
}

func TestPreparedAttachTrustedIdentityMatchesTransferredLease(t *testing.T) {
	now := time.Now().UTC()
	manager := testManager(t, t.TempDir(), &now, map[string]Signature{})
	root := makeWorkspace(t)
	proof, err := rootproof.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer proof.Close()
	prepared, decision, err := manager.BeginAttachTrusted(root, proof)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Abort()
	if err := prepared.Approve(decision.Token); err != nil {
		t.Fatal(err)
	}
	expected, err := prepared.TrustedRootIdentity()
	if err != nil {
		t.Fatal(err)
	}
	lease, err := prepared.TakeRootLease()
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	actual, err := lease.Stat(".")
	if err != nil || !os.SameFile(expected, actual) {
		t.Fatalf("trusted identity mismatch: %v", err)
	}
}
