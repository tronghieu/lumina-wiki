package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"sort"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/contract"
	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

type publicationOutcome struct {
	committed bool
	verified  bool
}

func (p *Provisioner) publishMaterialized(ctx context.Context, proof rootproof.RootProof,
	record pendingRecord, materialized contract.Materialized) (publicationOutcome, error) {
	root, err := proof.OpenRoot()
	if err != nil {
		return publicationOutcome{}, ErrPublication
	}
	defer root.Close()
	journal := buildJournal(record, materialized)
	resuming, err := ensureJournal(root, record.JournalName, journal)
	if err != nil {
		return publicationOutcome{}, err
	}
	if err := p.options.AfterStep("journal"); err != nil {
		return publicationOutcome{}, err
	}
	stage := provisionJournalPrefix + record.RecoveryID
	if err := ensureDirectory(root, stage, resuming); err != nil {
		return publicationOutcome{}, err
	}
	for _, directory := range materialized.Directories() {
		if err := ensureDirectory(root, stage+"/"+directory, resuming); err != nil {
			return publicationOutcome{}, err
		}
	}
	for _, file := range materialized.Files() {
		if err := ctx.Err(); err != nil {
			return publicationOutcome{}, err
		}
		if err := proof.Validate(); err != nil {
			return publicationOutcome{}, ErrPublication
		}
		if err := ensureStagedFile(root, stage+"/"+file.Path, file, resuming); err != nil {
			return publicationOutcome{}, err
		}
	}
	if err := syncDirectory(root, stage); err != nil {
		return publicationOutcome{}, ErrPublication
	}
	if err := p.options.AfterStep("staged"); err != nil {
		return publicationOutcome{}, err
	}
	if err := validateOwnedTree(root, journal, stage); err != nil {
		return publicationOutcome{}, err
	}
	if err := verifyJournalFiles(root, stage, journal.Files, false); err != nil {
		return publicationOutcome{}, err
	}

	for _, directory := range materialized.Directories() {
		if err := ctx.Err(); err != nil {
			return publicationOutcome{}, err
		}
		if err := proof.Validate(); err != nil {
			return publicationOutcome{}, ErrPublication
		}
		if err := ensureDirectory(root, directory, resuming); err != nil {
			return publicationOutcome{}, err
		}
		if err := p.options.AfterStep("directory:" + directory); err != nil {
			return publicationOutcome{}, err
		}
	}

	files := materialized.Files()
	sort.SliceStable(files, func(i, j int) bool {
		return publicationRank(files[i].Path) < publicationRank(files[j].Path)
	})
	manifestCommitted := false
	verificationFailed := false
	for _, file := range files {
		if !manifestCommitted {
			if err := ctx.Err(); err != nil {
				return publicationOutcome{}, err
			}
		}
		if err := proof.Validate(); err != nil {
			return publicationOutcome{}, ErrPublication
		}
		if err := verifyJournalFile(root, stage+"/"+file.Path, journalFile{
			Path: file.Path, SHA256: file.SHA256, Size: len(file.Bytes()),
		}); err != nil {
			return publicationOutcome{}, err
		}
		if err := publishFile(root, stage+"/"+file.Path, file, resuming); err != nil {
			if file.Path != "_lumina/manifest.json" || verifyRootFile(root, file.Path, file) != nil {
				return publicationOutcome{}, err
			}
			manifestCommitted = true
			verificationFailed = true
		}
		if file.Path == "_lumina/manifest.json" {
			manifestCommitted = true
		}
		if err := verifyRootFile(root, file.Path, file); err != nil {
			if !manifestCommitted {
				return publicationOutcome{}, err
			}
			verificationFailed = true
		}
		if err := p.options.AfterStep("published:" + file.Path); err != nil {
			if !manifestCommitted {
				return publicationOutcome{}, err
			}
			verificationFailed = true
		}
	}
	if !manifestCommitted {
		return publicationOutcome{}, ErrPublication
	}
	if err := validateOwnedTree(root, journal, stage); err != nil {
		verificationFailed = true
	}
	if err := verifyJournalFiles(root, "", journal.Files, false); err != nil {
		verificationFailed = true
	}
	if err := verifyJournal(root, record.JournalName, journal); err != nil {
		verificationFailed = true
	}
	return publicationOutcome{committed: true, verified: !verificationFailed}, nil
}

func publicationRank(name string) string {
	switch name {
	case "_lumina/_state/skills-manifest.csv":
		return "1:" + name
	case "_lumina/_state/files-manifest.csv":
		return "2:" + name
	case "_lumina/manifest.json":
		return "3:" + name
	default:
		return "0:" + name
	}
}

func ensureJournal(root *os.Root, name string, expected provisionJournal) (bool, error) {
	raw, err := encodeJournal(expected)
	if err != nil || len(raw) > maxJournalBytes {
		return false, ErrPublication
	}
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err == nil {
		if err := writeSyncClose(file, raw); err != nil {
			return false, ErrPublication
		}
		if err := syncDirectory(root, "."); err != nil {
			return false, ErrPublication
		}
		return false, nil
	}
	if !errors.Is(err, fs.ErrExist) {
		return false, ErrPublication
	}
	existing, err := readRootFile(root, name, maxJournalBytes)
	if err != nil {
		return false, ErrPublication
	}
	decoded, err := decodeJournal(existing)
	if err != nil || !journalsEqual(decoded, expected) {
		return false, ErrPublication
	}
	return true, nil
}

func ensureDirectory(root *os.Root, name string, allowExisting bool) error {
	err := root.Mkdir(name, 0o700)
	if err == nil {
		return nil
	}
	if !allowExisting || !errors.Is(err, fs.ErrExist) {
		return ErrPublication
	}
	info, statErr := treeLstat(root, name)
	if statErr != nil || !info.IsDir() {
		return ErrPublication
	}
	return nil
}

func ensureStagedFile(root *os.Root, name string, expected contract.File, allowExisting bool) error {
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err == nil {
		if err := writeSyncClose(file, expected.Bytes()); err != nil {
			return ErrPublication
		}
		return nil
	}
	if !allowExisting || !errors.Is(err, fs.ErrExist) {
		return ErrPublication
	}
	return verifyRootFile(root, name, expected)
}

func writeSyncClose(file *os.File, raw []byte) error {
	written, err := file.Write(raw)
	if err != nil || written != len(raw) {
		_ = file.Close()
		return io.ErrShortWrite
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

func verifyRootFile(root *os.Root, name string, expected contract.File) error {
	raw, err := readRootFile(root, name, len(expected.Bytes()))
	if err != nil || len(raw) != len(expected.Bytes()) || hashBytes(raw) != expected.SHA256 {
		return ErrPublication
	}
	return nil
}

func verifyJournalFile(root *os.Root, name string, expected journalFile) error {
	raw, err := readRootFile(root, name, expected.Size)
	if err != nil || len(raw) != expected.Size || hashBytes(raw) != expected.SHA256 {
		return ErrPublication
	}
	return nil
}

func verifyJournalFiles(root *os.Root, prefix string, files []journalFile, allowMissing bool) error {
	for _, file := range files {
		name := file.Path
		if prefix != "" {
			name = prefix + "/" + file.Path
		}
		err := verifyJournalFile(root, name, file)
		if allowMissing && errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func verifyJournal(root *os.Root, name string, expected provisionJournal) error {
	raw, err := readRootFile(root, name, maxJournalBytes)
	if err != nil {
		return ErrPublication
	}
	actual, err := decodeJournal(raw)
	if err != nil || !journalsEqual(actual, expected) {
		return ErrPublication
	}
	return nil
}

func validateCommittedEvidence(proof rootproof.RootProof, record pendingRecord,
	journal provisionJournal) error {
	if err := proof.Validate(); err != nil {
		return ErrPublication
	}
	root, err := proof.OpenRoot()
	if err != nil {
		return ErrPublication
	}
	defer root.Close()
	if err := verifyJournalFiles(root, "", journal.Files, false); err != nil {
		return err
	}
	return verifyJournal(root, record.JournalName, journal)
}

func readRootFile(root *os.Root, name string, limit int) ([]byte, error) {
	info, err := treeLstat(root, name)
	if err != nil || !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > int64(limit) {
		return nil, ErrPublication
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, ErrPublication
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, ErrPublication
	}
	raw, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil || len(raw) > limit {
		return nil, ErrPublication
	}
	return raw, nil
}

func publishFile(root *os.Root, staged string, expected contract.File, allowExisting bool) error {
	if err := root.Link(staged, expected.Path); err == nil {
		return syncDirectory(root, path.Dir(expected.Path))
	} else if errors.Is(err, fs.ErrExist) {
		if !allowExisting {
			return ErrPublication
		}
		return verifyRootFile(root, expected.Path, expected)
	}
	if err := platformPublishNoReplace(root, staged, expected.Path); err == nil {
		return syncDirectory(root, path.Dir(expected.Path))
	} else if !allowExisting || !errors.Is(err, fs.ErrExist) {
		return ErrPublication
	}
	return verifyRootFile(root, expected.Path, expected)
}

func syncDirectory(root *os.Root, name string) error {
	directory, err := root.Open(name)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func validateOwnedTree(root *os.Root, journal provisionJournal, stage string) error {
	allowed := map[string]bool{
		journalNameFor(journal): false,
		stage:                   true,
	}
	for _, directory := range journal.Directories {
		allowed[directory] = true
		allowed[stage+"/"+directory] = true
	}
	for _, file := range journal.Files {
		allowed[file.Path] = false
		allowed[stage+"/"+file.Path] = false
	}
	var scan func(string) error
	scanned := 0
	scan = func(directory string) error {
		file, err := root.Open(directory)
		if err != nil {
			return ErrPublication
		}
		entries, err := file.ReadDir(8193)
		_ = file.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			return ErrPublication
		}
		for _, entry := range entries {
			scanned++
			if scanned > 8192 {
				return ErrPublication
			}
			name := entry.Name()
			logical := name
			if directory != "." {
				logical = directory + "/" + name
			}
			wantDirectory, ok := allowed[logical]
			if !ok {
				return ErrPublication
			}
			info, err := treeLstat(root, logical)
			if err != nil || info.IsDir() != wantDirectory ||
				(!info.IsDir() && !info.Mode().IsRegular()) {
				return ErrPublication
			}
			if info.IsDir() {
				if err := scan(logical); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return scan(".")
}

func journalNameFor(journal provisionJournal) string {
	return provisionJournalPrefix + journal.RecoveryID + ".json"
}

func hashBytes(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
