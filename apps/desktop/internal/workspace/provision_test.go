package workspace

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
)

func newTestProvisioner(t *testing.T, options ProvisionOptions) *Provisioner {
	t.Helper()
	bundle, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	if options.Now == nil {
		options.Now = func() time.Time {
			return time.Date(2026, 7, 25, 1, 35, 42, 123_000_000, time.UTC)
		}
	}
	if options.RandomID == nil {
		options.RandomID = func() (string, error) { return "0123456789abcdef0123456789abcdef", nil }
	}
	config := t.TempDir()
	provisioner, err := NewProvisioner(bundle, config, options)
	if err != nil {
		t.Fatal(err)
	}
	return provisioner
}

type failingMaterializer struct {
	bundle contract.Bundle
	err    error
}

func (materializer failingMaterializer) Contract() contract.Contract {
	return materializer.bundle.Contract()
}

func (materializer failingMaterializer) Materialize(contract.RuntimeInputs) (contract.Materialized, error) {
	return contract.Materialized{}, materializer.err
}

func TestProvisionAbsentTargetAndManifestLast(t *testing.T) {
	var steps []string
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			steps = append(steps, step)
			return nil
		},
	})
	target := filepath.Join(t.TempDir(), `Lumina "Đọc"`)
	classification, err := provisioner.Classify(context.Background(), target)
	if err != nil || classification.State != TargetAbsent {
		t.Fatalf("classification=%+v err=%v", classification, err)
	}
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = result.Root.Close() })
	if result.State != TargetCommittedResidue || result.Root.Path() != target {
		t.Fatalf("result=%+v", result)
	}
	if err := result.Root.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"README.md",
		"_lumina/config/lumina.config.yaml",
		"_lumina/_state/skills-manifest.csv",
		"_lumina/_state/files-manifest.csv",
		"_lumina/manifest.json",
	} {
		info, err := os.Lstat(filepath.Join(target, filepath.FromSlash(name)))
		if err != nil || !info.Mode().IsRegular() {
			t.Fatalf("%s: %v %+v", name, err, info)
		}
	}
	manifestStep, filesStep := -1, -1
	for i, step := range steps {
		if step == "published:_lumina/manifest.json" {
			manifestStep = i
		}
		if step == "published:_lumina/_state/files-manifest.csv" {
			filesStep = i
		}
	}
	if manifestStep < 0 || filesStep < 0 || manifestStep <= filesStep {
		t.Fatalf("manifest was not last: %#v", steps)
	}
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingCommitted || pending.RecoveryID != result.RecoveryID {
		t.Fatalf("pending=%+v ok=%v err=%v", pending, ok, err)
	}
}

func TestProvisionEmptyTargetRequiresExplicitOption(t *testing.T) {
	target := t.TempDir()
	provisioner := newTestProvisioner(t, ProvisionOptions{})
	if _, err := provisioner.Provision(context.Background(), target); !errors.Is(err, ErrEmptyNeedsApproval) {
		t.Fatalf("error=%v", err)
	}
	entries, err := os.ReadDir(target)
	if err != nil || len(entries) != 0 {
		t.Fatalf("empty target mutated: %v %#v", err, entries)
	}
}

func TestExistingEmptyApprovalIsConsumedPerOperation(t *testing.T) {
	target := t.TempDir()
	legacyFlag := newTestProvisioner(t, ProvisionOptions{AllowExistingEmpty: true})
	if _, err := legacyFlag.Provision(context.Background(), target); !errors.Is(err, ErrEmptyNeedsApproval) {
		t.Fatalf("constructor-global flag authorized mutation: %v", err)
	}

	approvals := 0
	provisioner := newTestProvisioner(t, ProvisionOptions{
		ApproveExistingEmpty: func(context.Context, string) error {
			approvals++
			return nil
		},
	})
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Root.Close()
	if approvals != 1 {
		t.Fatalf("approval consumptions = %d", approvals)
	}
}

func TestClassifyRejectsSymlinkTarget(t *testing.T) {
	parent := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(parent, "link")
	if err := os.Symlink(outside, target); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	provisioner := newTestProvisioner(t, ProvisionOptions{})
	got, err := provisioner.Classify(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if got.State != TargetOccupied {
		t.Fatalf("classification=%+v", got)
	}
}

func TestProvisionNeverOverwritesDestinationRace(t *testing.T) {
	target := filepath.Join(t.TempDir(), "race")
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step == "staged" {
				return os.WriteFile(filepath.Join(target, "README.md"), []byte("foreign"), 0o600)
			}
			return nil
		},
	})
	_, err := provisioner.Provision(context.Background(), target)
	if err == nil {
		t.Fatal("destination race was accepted")
	}
	raw, readErr := os.ReadFile(filepath.Join(target, "README.md"))
	if readErr != nil || !bytes.Equal(raw, []byte("foreign")) {
		t.Fatalf("foreign destination changed: %q %v", raw, readErr)
	}
}

func TestInterruptedProvisionIsRecoverableAndRemoveNeverDeletesTarget(t *testing.T) {
	crash := errors.New("simulated crash")
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step == "journal" {
				return crash
			}
			return nil
		},
	})
	target := filepath.Join(t.TempDir(), "recoverable")
	if _, err := provisioner.Provision(context.Background(), target); !errors.Is(err, crash) {
		t.Fatalf("error=%v", err)
	}
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingMutating {
		t.Fatalf("pending=%+v ok=%v err=%v", pending, ok, err)
	}
	marker := filepath.Join(target, "keep-me")
	if err := os.WriteFile(marker, []byte("foreign"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := provisioner.RemovePending(context.Background(), pending.RecoveryID); err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(marker); err != nil || string(raw) != "foreign" {
		t.Fatalf("RemovePending touched target: %q %v", raw, err)
	}
}

func TestRetryPendingResumesMatchingImmutableJournal(t *testing.T) {
	crashed := false
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step == "published:README.md" && !crashed {
				crashed = true
				return errors.New("simulated crash")
			}
			return nil
		},
	})
	target := filepath.Join(t.TempDir(), "retry")
	if _, err := provisioner.Provision(context.Background(), target); err == nil {
		t.Fatal("simulated interruption returned success")
	}
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok {
		t.Fatalf("pending=%+v ok=%v err=%v", pending, ok, err)
	}
	result, err := provisioner.RetryPending(context.Background(), pending.RecoveryID)
	if err != nil {
		t.Fatalf("RetryPending: %v", err)
	}
	t.Cleanup(func() { _ = result.Root.Close() })
	if result.State != TargetCommittedResidue {
		t.Fatalf("result=%+v", result)
	}
	raw, err := os.ReadFile(filepath.Join(target, "README.md"))
	if err != nil || !bytes.HasPrefix(raw, []byte("# retry\n")) {
		t.Fatalf("README=%q err=%v", raw, err)
	}
}

func TestTargetRaceAfterApprovalNeverAdoptsForeignDirectory(t *testing.T) {
	target := filepath.Join(t.TempDir(), "raced-target")
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step != "pending:approved" {
				return nil
			}
			if err := os.Mkdir(target, 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(target, "foreign"), []byte("keep"), 0o600)
		},
	})
	if _, err := provisioner.Provision(context.Background(), target); err == nil {
		t.Fatal("foreign directory raced after approval was adopted")
	}
	raw, err := os.ReadFile(filepath.Join(target, "foreign"))
	if err != nil || string(raw) != "keep" {
		t.Fatalf("foreign content changed: %q %v", raw, err)
	}
}

func TestStagedBytesAreRehashedImmediatelyBeforePublication(t *testing.T) {
	target := filepath.Join(t.TempDir(), "staged-tamper")
	id := "0123456789abcdef0123456789abcdef"
	provisioner := newTestProvisioner(t, ProvisionOptions{
		RandomID: func() (string, error) { return id, nil },
		AfterStep: func(step string) error {
			if step != "staged" {
				return nil
			}
			return os.WriteFile(filepath.Join(target, provisionJournalPrefix+id, "README.md"),
				[]byte("tampered"), 0o600)
		},
	})
	if _, err := provisioner.Provision(context.Background(), target); !errors.Is(err, ErrPublication) {
		t.Fatalf("staged tamper = %v", err)
	}
	if _, err := os.Lstat(filepath.Join(target, "README.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("tampered bytes reached final destination: %v", err)
	}
}

func TestMaterializationFailureLeavesOnlyProvenEmptyTargetAndApprovedPending(t *testing.T) {
	bundle, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	provisioner, err := NewProvisioner(failingMaterializer{bundle: bundle, err: errors.New("render failed")},
		t.TempDir(), ProvisionOptions{
			Now:      func() time.Time { return time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC) },
			RandomID: func() (string, error) { return "abcdefabcdefabcdefabcdefabcdefab", nil },
		})
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "materialize-failure")
	if _, err := provisioner.Provision(context.Background(), target); !errors.Is(err, ErrInvalidProvisioner) {
		t.Fatalf("materialization error = %v", err)
	}
	entries, err := os.ReadDir(target)
	if err != nil || len(entries) != 0 {
		t.Fatalf("target residue = %#v, %v", entries, err)
	}
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingApproved {
		t.Fatalf("pending = %#v, %v, %v", pending, ok, err)
	}
}

func TestManifestPublicationHookFailureConvergesToCommittedSuccess(t *testing.T) {
	crash := errors.New("crash after manifest publication")
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step == "published:_lumina/manifest.json" {
				return crash
			}
			return nil
		},
	})
	target := filepath.Join(t.TempDir(), "manifest-committed")
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatalf("post-manifest hook escaped as failure: %v", err)
	}
	defer result.Root.Close()
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingCommitted {
		t.Fatalf("pending = %#v, %v, %v", pending, ok, err)
	}
	retried, err := provisioner.RetryPending(context.Background(), pending.RecoveryID)
	if err != nil {
		t.Fatalf("committed retry = %v", err)
	}
	defer retried.Root.Close()
}

func TestCancellationAfterManifestPublicationConvergesToCommittedSuccess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	provisioner := newTestProvisioner(t, ProvisionOptions{
		AfterStep: func(step string) error {
			if step == "published:_lumina/manifest.json" {
				cancel()
				return context.Canceled
			}
			return nil
		},
	})
	result, err := provisioner.Provision(ctx, filepath.Join(t.TempDir(), "cancel-after-commit"))
	if err != nil {
		t.Fatalf("post-commit cancellation escaped: %v", err)
	}
	defer result.Root.Close()
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingCommitted {
		t.Fatalf("pending = %#v, %v, %v", pending, ok, err)
	}
}

func TestManifestMissingWithStateCSVsIsMalformedNotLegacy(t *testing.T) {
	rootPath := t.TempDir()
	if err := os.MkdirAll(filepath.Join(rootPath, "_lumina", "_state"), 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"skills-manifest.csv", "files-manifest.csv"} {
		if err := os.WriteFile(filepath.Join(rootPath, "_lumina", "_state", name), []byte("orphan\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	classification, err := classifyHeldRoot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if classification.State == TargetLegacy {
		t.Fatalf("orphan state classified as legacy: %#v", classification)
	}
}

func TestJournalDetectionDoesNotDependOnDirectoryEntryOrder(t *testing.T) {
	rootPath := t.TempDir()
	for index := 0; index < 16; index++ {
		name := filepath.Join(rootPath, fmt.Sprintf("ordinary-%02d", index))
		if err := os.WriteFile(name, []byte("ordinary"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(rootPath,
		provisionJournalPrefix+"0123456789abcdef0123456789abcdef.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	classification, err := classifyHeldRoot(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if classification.State != TargetInterrupted {
		t.Fatalf("journal was missed: %#v", classification)
	}
}

func TestCommittedRetryNeverDeletesReplacedJournal(t *testing.T) {
	provisioner := newTestProvisioner(t, ProvisionOptions{})
	target := filepath.Join(t.TempDir(), "foreign-journal")
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Root.Close()
	journal := filepath.Join(target, provisionJournalPrefix+result.RecoveryID+".json")
	if err := os.WriteFile(journal, []byte(`{"foreign":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	retried, err := provisioner.RetryPending(context.Background(), result.RecoveryID)
	if err != nil {
		t.Fatal(err)
	}
	defer retried.Root.Close()
	if retried.State != TargetCommittedResidue {
		t.Fatalf("retry state = %s", retried.State)
	}
	raw, err := os.ReadFile(journal)
	if err != nil || string(raw) != `{"foreign":true}` {
		t.Fatalf("foreign journal changed: %q %v", raw, err)
	}
}

func TestPostManifestInventoryFailurePreservesCommittedRecoveryEvidence(t *testing.T) {
	target := filepath.Join(t.TempDir(), "post-commit-corruption")
	id := "0123456789abcdef0123456789abcdef"
	provisioner := newTestProvisioner(t, ProvisionOptions{
		RandomID: func() (string, error) { return id, nil },
		AfterStep: func(step string) error {
			if step != "published:_lumina/manifest.json" {
				return nil
			}
			return os.WriteFile(filepath.Join(target, "README.md"), []byte("corrupted after commit"), 0o600)
		},
	})
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatalf("manifest-committed operation returned failure: %v", err)
	}
	defer result.Root.Close()
	if result.State != TargetCommittedResidue {
		t.Fatalf("state = %s", result.State)
	}
	journal := filepath.Join(target, provisionJournalPrefix+id+".json")
	stage := filepath.Join(target, provisionJournalPrefix+id)
	if _, err := os.Lstat(journal); err != nil {
		t.Fatalf("journal evidence was removed: %v", err)
	}
	if info, err := os.Lstat(stage); err != nil || !info.IsDir() {
		t.Fatalf("stage evidence was removed: %#v, %v", info, err)
	}
	pending, ok, err := provisioner.PendingOperation(context.Background())
	if err != nil || !ok || pending.Phase != PendingCommitted {
		t.Fatalf("pending = %#v, %v, %v", pending, ok, err)
	}
	retried, err := provisioner.RetryPending(context.Background(), result.RecoveryID)
	if err != nil {
		t.Fatalf("committed-residue retry returned failure: %v", err)
	}
	defer retried.Root.Close()
	if retried.State != TargetCommittedResidue {
		t.Fatalf("retry state = %s", retried.State)
	}
	if _, err := os.Lstat(journal); err != nil {
		t.Fatalf("retry removed recovery evidence: %v", err)
	}
}

func TestCommittedResidueNeverDeletesForeignTransactionEntries(t *testing.T) {
	target := filepath.Join(t.TempDir(), "retained-residue")
	id := "abcdefabcdefabcdefabcdefabcdefab"
	provisioner := newTestProvisioner(t, ProvisionOptions{
		RandomID: func() (string, error) { return id, nil },
	})
	result, err := provisioner.Provision(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Root.Close()
	if result.State != TargetCommittedResidue {
		t.Fatalf("cleanup was claimed without identity-atomic deletion: %s", result.State)
	}
	foreign := filepath.Join(target, provisionJournalPrefix+id, "foreign-entry")
	if err := os.WriteFile(foreign, []byte("foreign"), 0o600); err != nil {
		t.Fatalf("transaction root was not retained: %v", err)
	}
	retried, err := provisioner.RetryPending(context.Background(), result.RecoveryID)
	if err != nil {
		t.Fatalf("retry with foreign residue: %v", err)
	}
	defer retried.Root.Close()
	if retried.State != TargetCommittedResidue {
		t.Fatalf("retry state = %s", retried.State)
	}
	raw, err := os.ReadFile(foreign)
	if err != nil || string(raw) != "foreign" {
		t.Fatalf("foreign entry was deleted or changed: %q, %v", raw, err)
	}
}

func TestProvisionerCreationGateSerializesAcrossProcesses(t *testing.T) {
	if config := os.Getenv("LUMINA_PROVISION_LOCK_CONFIG"); config != "" {
		bundle, err := contract.Load()
		if err != nil {
			os.Exit(2)
		}
		provisioner, err := NewProvisioner(bundle, config, ProvisionOptions{})
		if err != nil {
			os.Exit(3)
		}
		signal := os.Getenv("LUMINA_PROVISION_LOCK_SIGNAL")
		release := os.Getenv("LUMINA_PROVISION_LOCK_RELEASE")
		err = provisioner.withCreationLock(context.Background(), func() error {
			if err := os.WriteFile(signal, []byte("held"), 0o600); err != nil {
				return err
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				if _, err := os.Stat(release); err == nil {
					return nil
				}
				time.Sleep(10 * time.Millisecond)
			}
			return errors.New("release timeout")
		})
		if err != nil {
			os.Exit(4)
		}
		os.Exit(0)
	}

	base := t.TempDir()
	config := filepath.Join(base, "config")
	if err := os.Mkdir(config, 0o700); err != nil {
		t.Fatal(err)
	}
	signal := filepath.Join(base, "held")
	release := filepath.Join(base, "release")
	command := exec.Command(os.Args[0], "-test.run=TestProvisionerCreationGateSerializesAcrossProcesses")
	command.Env = append(os.Environ(),
		"LUMINA_PROVISION_LOCK_CONFIG="+config,
		"LUMINA_PROVISION_LOCK_SIGNAL="+signal,
		"LUMINA_PROVISION_LOCK_RELEASE="+release,
	)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = os.WriteFile(release, []byte("release"), 0o600)
		_ = command.Wait()
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(signal); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("child did not acquire the creation gate")
		}
		time.Sleep(10 * time.Millisecond)
	}
	bundle, err := contract.Load()
	if err != nil {
		t.Fatal(err)
	}
	provisioner, err := NewProvisioner(bundle, config, ProvisionOptions{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	target := filepath.Join(base, "must-stay-absent")
	if _, err := provisioner.Provision(ctx, target); !errors.Is(err, ErrProvisionState) {
		t.Fatalf("contended provision error = %v", err)
	}
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("contended provision touched target: %v", err)
	}
}
