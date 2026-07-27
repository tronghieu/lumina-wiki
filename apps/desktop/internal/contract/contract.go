// Package contract loads and verifies the generated Desktop workspace payload.
package contract

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing/fstest"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

const (
	currentContractVersion        = 1
	currentMaterializationVersion = 1
	currentInstallerPackage       = "1.9.2"
	currentManifestSchema         = 4
	currentWikiSchema             = "0.1.0"
	// expectedStrictSemanticsDigest pins every non-inventory field that defines
	// the one supported Desktop profile. A self-signed asset tree cannot use its
	// own checksum to redefine versions, schema, skills, or materialization.
	expectedStrictSemanticsDigest = "f59fb88e5cd7c23e05038c6c94a4ef9f92a6074afb2cfb1421cbe5edb8510ef3"
	maxContractBytes              = 2 * 1024 * 1024
	maxPayloadFiles               = 4096
	maxPayloadDirectories         = 4096
	maxPayloadFileBytes           = 4 * 1024 * 1024
	maxPayloadTotalBytes          = 64 * 1024 * 1024
	maxLogicalPathBytes           = 1024
)

var (
	//go:embed all:assets
	embeddedAssets embed.FS

	loadOnce   sync.Once
	loaded     Bundle
	loadedErr  error
	checksumRE = regexp.MustCompile(`^[0-9a-f]{64}\n$`)
	driveRE    = regexp.MustCompile(`^[A-Za-z]:`)
	reservedRE = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)
)

type Versions struct {
	Contract         int    `json:"contract"`
	InstallerPackage string `json:"installerPackage"`
	ManifestSchema   int    `json:"manifestSchema"`
	WikiSchema       string `json:"wikiSchema"`
}

type Profile struct {
	CommunicationLang  string   `json:"communicationLang"`
	DocumentOutputLang string   `json:"documentOutputLang"`
	ID                 string   `json:"id"`
	IDETargets         []string `json:"ideTargets"`
	Locale             string   `json:"locale"`
	Packs              []string `json:"packs"`
	ProjectName        string   `json:"projectName"`
	ResearchPurpose    string   `json:"researchPurpose"`
}

type Limits struct {
	DirectoryCount      int   `json:"directoryCount"`
	FileCount           int   `json:"fileCount"`
	MaxFileBytes        int64 `json:"maxFileBytes"`
	MaxLogicalPathBytes int   `json:"maxLogicalPathBytes"`
	TotalBytes          int64 `json:"totalBytes"`
}

type PayloadEntry struct {
	Kind   string `json:"kind"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type PayloadContract struct {
	Entries          []PayloadEntry `json:"entries"`
	RootDigest       string         `json:"rootDigest"`
	RootDigestRecord string         `json:"rootDigestRecord"`
	TotalBytes       int64          `json:"totalBytes"`
	TotalDirectories int            `json:"totalDirectories"`
	TotalFiles       int            `json:"totalFiles"`
}

type Skill struct {
	CanonicalID string `json:"canonicalId"`
	DisplayName string `json:"displayName"`
	Inert       bool   `json:"inert"`
	Name        string `json:"name"`
	Pack        string `json:"pack"`
	SourcePath  string `json:"sourcePath"`
}

type StateContract struct {
	FilesCSVHeader   string   `json:"filesCsvHeader"`
	FilesCSVPath     string   `json:"filesCsvPath"`
	ManagedFilePaths []string `json:"managedFilePaths"`
	ManifestPath     string   `json:"manifestPath"`
	SkillsCSVHeader  string   `json:"skillsCsvHeader"`
	SkillsCSVPath    string   `json:"skillsCsvPath"`
}

type ClockRecipe struct {
	CreatedAt   string `json:"createdAt"`
	Input       string `json:"input"`
	InstalledAt string `json:"installedAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type MaterializationFile struct {
	Action string `json:"action"`
	Path   string `json:"path"`
	Source string `json:"source,omitempty"`
}

type HashRecipe struct {
	Algorithm          string `json:"algorithm"`
	FilesManifestInput string `json:"filesManifestInput"`
	Output             string `json:"output"`
}

type PayloadRecipe struct {
	Source            string `json:"source"`
	StaticEntryKind   string `json:"staticEntryKind"`
	TemplateAction    string `json:"templateAction"`
	TemplateEntryKind string `json:"templateEntryKind"`
}

type ReadmeRecipe struct {
	DefaultPurpose string `json:"defaultPurpose"`
	Heading        string `json:"heading"`
	Insertion      string `json:"insertion"`
	Purpose        string `json:"purpose"`
}

type RenderRecipe struct {
	Conditionals     string       `json:"conditionals"`
	Engine           string       `json:"engine"`
	LineEndings      string       `json:"lineEndings"`
	Readme           ReadmeRecipe `json:"readme"`
	UnknownVariables string       `json:"unknownVariables"`
}

type ConfigSerialization struct {
	Format      string   `json:"format"`
	Header      []string `json:"header"`
	Indentation int      `json:"indentation"`
	KeyOrder    string   `json:"keyOrder"`
	LineWidth   int      `json:"lineWidth"`
}

type CSVSerialization struct {
	Delimiter    string `json:"delimiter"`
	EscapedQuote string `json:"escapedQuote"`
	Format       string `json:"format"`
	Quote        string `json:"quote"`
	QuoteWhen    string `json:"quoteWhen"`
}

type ManifestSerialization struct {
	Format      string `json:"format"`
	Indentation int    `json:"indentation"`
	KeyOrder    string `json:"keyOrder"`
}

type SerializationRecipe struct {
	Config       ConfigSerialization   `json:"config"`
	CSV          CSVSerialization      `json:"csv"`
	FinalNewline bool                  `json:"finalNewline"`
	Manifest     ManifestSerialization `json:"manifest"`
}

type FilesCSVRecipe struct {
	Columns          []string `json:"columns"`
	InstalledVersion string   `json:"installedVersion"`
	Rows             string   `json:"rows"`
	SourcePack       string   `json:"sourcePack"`
}

type SkillCSVRow struct {
	CanonicalID    string `json:"canonical_id"`
	DisplayName    string `json:"display_name"`
	Pack           string `json:"pack"`
	RelativePath   string `json:"relative_path"`
	Source         string `json:"source"`
	TargetLinkPath string `json:"target_link_path"`
	Version        string `json:"version"`
}

type SkillsCSVRecipe struct {
	Columns      []string      `json:"columns"`
	RelativePath string        `json:"relativePath"`
	Rows         []SkillCSVRow `json:"rows"`
}

type MaterializationState struct {
	FilesCSV   FilesCSVRecipe  `json:"filesCsv"`
	SkillsCSV  SkillsCSVRecipe `json:"skillsCsv"`
	WriteOrder []string        `json:"writeOrder"`
}

type Materialization struct {
	AllowedSubstitutions []string              `json:"allowedSubstitutions"`
	Clock                ClockRecipe           `json:"clock"`
	Config               json.RawMessage       `json:"config"`
	DirectoriesSource    string                `json:"directoriesSource"`
	Files                []MaterializationFile `json:"files"`
	Hash                 HashRecipe            `json:"hash"`
	Manifest             json.RawMessage       `json:"manifest"`
	Payload              PayloadRecipe         `json:"payload"`
	Render               RenderRecipe          `json:"render"`
	RuntimeInputs        []string              `json:"runtimeInputs"`
	Serialization        SerializationRecipe   `json:"serialization"`
	State                MaterializationState  `json:"state"`
	Version              int                   `json:"version"`
}

type Contract struct {
	Directories     []string                   `json:"directories"`
	Limits          Limits                     `json:"limits"`
	LintCheckIDs    []string                   `json:"lintCheckIds"`
	Materialization Materialization            `json:"materialization"`
	Payload         PayloadContract            `json:"payload"`
	Profile         Profile                    `json:"profile"`
	Schema          map[string]json.RawMessage `json:"schema"`
	Skills          []Skill                    `json:"skills"`
	State           StateContract              `json:"state"`
	Versions        Versions                   `json:"versions"`
}

type bundleData struct {
	contract Contract
	payload  fstest.MapFS
}

// Bundle contains one fully verified contract and payload.
type Bundle struct {
	data *bundleData
}

// Load verifies the embedded generated boundary once for the process.
func Load() (Bundle, error) {
	loadOnce.Do(func() {
		assets, err := fs.Sub(embeddedAssets, "assets")
		if err != nil {
			loadedErr = err
			return
		}
		loaded, loadedErr = loadFS(assets)
	})
	return loaded, loadedErr
}

func loadFS(assets fs.FS) (Bundle, error) {
	contractBytes, err := readLimitedFile(assets, "contract.json", maxContractBytes)
	if err != nil {
		return Bundle{}, fmt.Errorf("contract: %w", err)
	}
	checksumBytes, err := readLimitedFile(assets, "contract.sha256", 65)
	if err != nil {
		return Bundle{}, fmt.Errorf("contract checksum: %w", err)
	}
	if !checksumRE.Match(checksumBytes) {
		return Bundle{}, errors.New("contract checksum is not canonical lowercase sha256")
	}
	sum := sha256.Sum256(contractBytes)
	if !bytes.Equal(checksumBytes[:64], []byte(hex.EncodeToString(sum[:]))) {
		return Bundle{}, errors.New("contract checksum mismatch")
	}
	if err := rejectDuplicateJSONKeys(contractBytes); err != nil {
		return Bundle{}, fmt.Errorf("contract JSON: %w", err)
	}
	var canonicalValue any
	canonicalDecoder := json.NewDecoder(bytes.NewReader(contractBytes))
	canonicalDecoder.UseNumber()
	if err := canonicalDecoder.Decode(&canonicalValue); err != nil {
		return Bundle{}, fmt.Errorf("decode contract JSON: %w", err)
	}
	canonicalBytes, err := canonicalJSON(canonicalValue)
	if err != nil || !bytes.Equal(contractBytes, canonicalBytes) {
		return Bundle{}, errors.New("contract JSON is not canonical")
	}

	var contract Contract
	decoder := json.NewDecoder(bytes.NewReader(contractBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&contract); err != nil {
		return Bundle{}, fmt.Errorf("decode contract: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Bundle{}, err
	}
	if err := validateContractShape(contract); err != nil {
		return Bundle{}, err
	}
	payload, err := verifyPayload(assets, contract)
	if err != nil {
		return Bundle{}, err
	}
	return Bundle{data: &bundleData{contract: contract, payload: payload}}, nil
}

func readLimitedFile(fsys fs.FS, name string, limit int64) ([]byte, error) {
	file, err := fsys.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&(fs.ModeSymlink|fs.ModeType) != 0 {
		return nil, errors.New("entry is not a regular file")
	}
	if info.Size() < 0 || info.Size() > limit {
		return nil, errors.New("entry exceeds byte ceiling")
	}
	reader := io.LimitReader(file, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("entry exceeds byte ceiling")
	}
	return data, nil
}

func validateContractShape(c Contract) error {
	if c.Versions.Contract != currentContractVersion ||
		c.Versions.InstallerPackage != currentInstallerPackage ||
		c.Versions.ManifestSchema != currentManifestSchema ||
		c.Versions.WikiSchema != currentWikiSchema {
		return errors.New("unsupported contract version")
	}
	if c.Materialization.Version != currentMaterializationVersion {
		return errors.New("unsupported materialization version")
	}
	if digest := strictSemanticsDigest(c); digest != expectedStrictSemanticsDigest {
		return fmt.Errorf("unsupported fixed contract semantics: %s", digest)
	}
	if !equalStrings(c.Materialization.RuntimeInputs, []string{"projectName", "now", "root"}) {
		return errors.New("invalid runtime input contract")
	}
	if c.Limits.FileCount < 0 || c.Limits.FileCount > maxPayloadFiles ||
		c.Limits.DirectoryCount < 0 || c.Limits.DirectoryCount > maxPayloadDirectories ||
		c.Limits.MaxFileBytes < 0 || c.Limits.MaxFileBytes > maxPayloadFileBytes ||
		c.Limits.TotalBytes < 0 || c.Limits.TotalBytes > maxPayloadTotalBytes ||
		c.Limits.MaxLogicalPathBytes < 0 || c.Limits.MaxLogicalPathBytes > maxLogicalPathBytes {
		return errors.New("declared contract limits exceed independent ceilings")
	}
	if len(c.Payload.Entries) > maxPayloadFiles || len(c.Directories) > maxPayloadDirectories {
		return errors.New("payload count exceeds independent ceiling")
	}
	if !isLowerHex(c.Payload.RootDigest) ||
		c.Payload.RootDigestRecord != `<kind>\0<path>\0<size>\0<sha256-or-dash>\n` {
		return errors.New("invalid payload root digest contract")
	}
	expectedSchema := []string{
		"edgeTypes", "entityDirs", "enums", "exemptionGlobs", "externalIdNamespaces",
		"lintCheckIds", "packManifestShape", "rawDirs", "requiredFrontmatter",
	}
	if !exactKeys(c.Schema, expectedSchema) {
		return errors.New("schema has missing or unknown fields")
	}
	if err := validateRecipeObjects(c.Materialization); err != nil {
		return err
	}
	if err := validateMaterializationPaths(c); err != nil {
		return err
	}
	if err := validateRecipeContract(c); err != nil {
		return err
	}
	return nil
}

func strictSemanticsDigest(c Contract) string {
	strict := struct {
		LintCheckIDs    []string                   `json:"lintCheckIds"`
		Materialization Materialization            `json:"materialization"`
		Profile         Profile                    `json:"profile"`
		Schema          map[string]json.RawMessage `json:"schema"`
		Skills          []Skill                    `json:"skills"`
		State           StateContract              `json:"state"`
		Versions        Versions                   `json:"versions"`
	}{
		LintCheckIDs:    c.LintCheckIDs,
		Materialization: c.Materialization,
		Profile:         c.Profile,
		Schema:          c.Schema,
		Skills:          c.Skills,
		State:           c.State,
		Versions:        c.Versions,
	}
	raw, err := json.Marshal(strict)
	if err != nil {
		return ""
	}
	return sha256Hex(raw)
}

func validateMaterializationPaths(c Contract) error {
	seen := make(map[string]string, len(c.Directories)+len(c.Payload.Entries)+len(c.Materialization.Files))
	payloadKinds := make(map[string]string, len(c.Payload.Entries))
	for _, directory := range c.Directories {
		if err := validateLogicalPath(directory); err != nil {
			return fmt.Errorf("materialization directory %q: %w", directory, err)
		}
		if err := addLogicalPath(seen, directory); err != nil {
			return err
		}
	}
	for _, entry := range c.Payload.Entries {
		if err := validateLogicalPath(entry.Path); err != nil {
			return fmt.Errorf("materialization payload path %q: %w", entry.Path, err)
		}
		if err := addLogicalPath(seen, entry.Path); err != nil {
			return err
		}
		payloadKinds[entry.Path] = entry.Kind
	}
	for _, file := range c.Materialization.Files {
		if err := validateLogicalPath(file.Path); err != nil {
			return fmt.Errorf("materialization output path %q: %w", file.Path, err)
		}
		if file.Action == "render-readme" {
			if file.Path != file.Source || payloadKinds[file.Source] != "template" {
				return errors.New("declared template replacement is not exact")
			}
			continue
		}
		if file.Source != "" {
			return errors.New("runtime-state output has an unexpected source")
		}
		if err := addLogicalPath(seen, file.Path); err != nil {
			return fmt.Errorf("runtime-state output collision: %w", err)
		}
		if parent := path.Dir(file.Path); parent != "." {
			if _, ok := seen[strings.ToLower(parent)]; !ok {
				return fmt.Errorf("runtime-state parent directory is undeclared: %q", file.Path)
			}
		}
	}
	return nil
}

func validateRecipeContract(c Contract) error {
	m := c.Materialization
	if !equalStrings(m.AllowedSubstitutions, []string{
		"project_name", "locale", "communication_language", "document_output_language",
		"pack_core", "pack_research", "pack_reading", "pack_learning", "created_at",
		"schema_version",
	}) ||
		m.DirectoriesSource != "contract.directories" ||
		m.Hash.Algorithm != "sha256" ||
		m.Hash.Output != "lowercase hex" ||
		m.Payload.Source != "contract.payload.entries" ||
		m.Payload.StaticEntryKind != "static" ||
		m.Payload.TemplateEntryKind != "template" ||
		m.Render.Engine != "lumina-template-v1" ||
		m.Render.LineEndings != "lf" ||
		!m.Serialization.FinalNewline {
		return errors.New("unsupported materialization recipe")
	}
	expectedFiles := []MaterializationFile{
		{Action: "render-readme", Path: "README.md", Source: "README.md"},
		{Action: "serialize-config", Path: "_lumina/config/lumina.config.yaml"},
		{Action: "serialize-manifest", Path: "_lumina/manifest.json"},
		{Action: "serialize-skills-csv", Path: "_lumina/_state/skills-manifest.csv"},
		{Action: "serialize-files-csv-after-target-hashes", Path: "_lumina/_state/files-manifest.csv"},
	}
	if len(m.Files) != len(expectedFiles) {
		return errors.New("unexpected materialization file inventory")
	}
	for i := range expectedFiles {
		if m.Files[i] != expectedFiles[i] {
			return errors.New("unexpected materialization file recipe")
		}
	}
	if c.State.ManifestPath != "_lumina/manifest.json" ||
		c.State.SkillsCSVPath != "_lumina/_state/skills-manifest.csv" ||
		c.State.FilesCSVPath != "_lumina/_state/files-manifest.csv" ||
		c.State.SkillsCSVHeader != strings.Join(m.State.SkillsCSV.Columns, ",") ||
		c.State.FilesCSVHeader != strings.Join(m.State.FilesCSV.Columns, ",") ||
		m.State.FilesCSV.InstalledVersion != c.Versions.InstallerPackage {
		return errors.New("state recipe disagrees with contract")
	}
	if !equalStrings(m.State.FilesCSV.Columns, []string{
		"relative_path", "sha256", "source_pack", "installed_version",
	}) || !equalStrings(m.State.SkillsCSV.Columns, []string{
		"canonical_id", "display_name", "pack", "source", "relative_path",
		"target_link_path", "version",
	}) {
		return errors.New("unsupported CSV columns")
	}
	seenManaged := make(map[string]string)
	for _, name := range c.State.ManagedFilePaths {
		if err := validateLogicalPath(name); err != nil {
			return fmt.Errorf("managed path %q: %w", name, err)
		}
		if err := addLogicalPath(seenManaged, name); err != nil {
			return err
		}
	}
	for _, skill := range c.Skills {
		if filepathIsAbsoluteOrUnsafe(skill.SourcePath) {
			return errors.New("skill source path is not repository-relative")
		}
	}
	return validateRuntimePlaceholders(m, c)
}

func validateRuntimePlaceholders(m Materialization, c Contract) error {
	var config map[string]any
	var manifest map[string]any
	if err := json.Unmarshal(m.Config, &config); err != nil {
		return err
	}
	if err := json.Unmarshal(m.Manifest, &manifest); err != nil {
		return err
	}
	if config["project_name"] != "$runtime.projectName" ||
		config["created_at"] != "$runtime.now.utcDate" ||
		config["locale"] != c.Profile.Locale ||
		config["communication_language"] != c.Profile.CommunicationLang ||
		config["document_output_language"] != c.Profile.DocumentOutputLang {
		return errors.New("invalid config runtime placeholders")
	}
	resolved, ok := manifest["resolvedPaths"].(map[string]any)
	if !ok ||
		resolved["projectRoot"] != "$runtime.root" ||
		resolved["wiki"] != "$runtime.root/wiki" ||
		resolved["raw"] != "$runtime.root/raw" ||
		resolved["agents"] != "$runtime.root/.agents" ||
		resolved["lumina"] != "$runtime.root/_lumina" ||
		manifest["installedAt"] != "$runtime.now.rfc3339" ||
		manifest["updatedAt"] != "$runtime.now.rfc3339" ||
		manifest["packageVersion"] != c.Versions.InstallerPackage ||
		manifest["schemaVersion"] != float64(c.Versions.ManifestSchema) {
		return errors.New("invalid manifest runtime placeholders")
	}
	return nil
}

func filepathIsAbsoluteOrUnsafe(name string) bool {
	return strings.HasPrefix(name, "/") || strings.Contains(name, `\`) ||
		driveRE.MatchString(name) || strings.Contains(name, "..")
}

func validateRecipeObjects(m Materialization) error {
	configAllowed := objectShape{
		"communication_language": nil, "created_at": nil, "document_output_language": nil,
		"ide_targets":  objectShape{"claude_code": nil, "codex": nil, "cursor": nil, "gemini_cli": nil, "generic": nil, "iflow": nil, "qwen": nil},
		"integrations": objectShape{"marp_slides": nil, "obsidian_vault": nil, "qmd_search": nil},
		"lint": objectShape{
			"checks":       objectShape{"broken_links": nil, "index_freshness": nil, "log_format": nil, "missing_reverse_links": nil, "orphan_pages": nil, "stale_claims": nil},
			"default_mode": nil,
		},
		"locale":       nil,
		"packs":        objectShape{"core": nil, "learning": nil, "reading": nil, "research": nil},
		"paths":        objectShape{"_lumina": nil, "agents": nil, "index": nil, "log": nil, "raw": nil, "wiki": nil},
		"project_name": nil, "telemetry": nil,
		"wiki": objectShape{
			"bidirectional_links": objectShape{"exemptions": nil, "mode": nil},
			"graph":               objectShape{"edge_types_core": nil, "enabled": nil},
			"link_syntax":         nil, "log_prefix": nil, "slug_style": nil,
		},
	}
	manifestAllowed := objectShape{
		"ideTargets": nil, "installedAt": nil, "locale": nil, "packageVersion": nil,
		"packs":         objectShape{"core": objectShape{"source": nil, "version": nil}},
		"resolvedPaths": objectShape{"agents": nil, "lumina": nil, "projectRoot": nil, "raw": nil, "wiki": nil},
		"schemaVersion": nil, "symlinkStrategies": objectShape{}, "updatedAt": nil,
	}
	if err := validateJSONObject(m.Config, configAllowed); err != nil {
		return fmt.Errorf("materialization config: %w", err)
	}
	if err := validateJSONObject(m.Manifest, manifestAllowed); err != nil {
		return fmt.Errorf("materialization manifest: %w", err)
	}
	return nil
}

type objectShape map[string]objectShape

func validateJSONObject(raw json.RawMessage, shape objectShape) error {
	var value map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if !exactKeys(value, sortedShapeKeys(shape)) {
		return errors.New("missing or unknown field")
	}
	for key, childShape := range shape {
		if childShape == nil {
			continue
		}
		var object map[string]json.RawMessage
		if err := json.Unmarshal(value[key], &object); err != nil {
			return fmt.Errorf("%s is not an object", key)
		}
		if len(childShape) == 0 {
			if len(object) != 0 {
				return fmt.Errorf("%s must be empty", key)
			}
			continue
		}
		if err := validateJSONObject(value[key], childShape); err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
	}
	return nil
}

func sortedShapeKeys(shape objectShape) []string {
	keys := make([]string, 0, len(shape))
	for key := range shape {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func exactKeys[T any](value map[string]T, expected []string) bool {
	if len(value) != len(expected) {
		return false
	}
	for _, key := range expected {
		if _, ok := value[key]; !ok {
			return false
		}
	}
	return true
}

func verifyPayload(assets fs.FS, c Contract) (fstest.MapFS, error) {
	if len(c.Payload.Entries) != c.Limits.FileCount ||
		len(c.Directories) != c.Limits.DirectoryCount ||
		c.Payload.TotalFiles != c.Limits.FileCount ||
		c.Payload.TotalDirectories != c.Limits.DirectoryCount {
		return nil, errors.New("payload count mismatch")
	}
	seen := make(map[string]string, len(c.Directories)+len(c.Payload.Entries))
	allRecords := make([]digestRecord, 0, len(c.Directories)+len(c.Payload.Entries))
	payload := make(fstest.MapFS, len(c.Directories)+len(c.Payload.Entries))
	var previous string
	var total int64
	var maxFile int64
	var maxPath int

	for i, directory := range c.Directories {
		if err := validateLogicalPath(directory); err != nil {
			return nil, fmt.Errorf("directory %q: %w", directory, err)
		}
		if i > 0 && !(previous < directory) {
			return nil, errors.New("directories are not strictly UTF-8 sorted")
		}
		previous = directory
		if err := addLogicalPath(seen, directory); err != nil {
			return nil, err
		}
		payload[directory] = &fstest.MapFile{Mode: fs.ModeDir | 0o555}
		allRecords = append(allRecords, digestRecord{"directory", directory, 0, "-"})
		if len([]byte(directory)) > maxPath {
			maxPath = len([]byte(directory))
		}
	}

	previous = ""
	declaredFiles := make(map[string]struct{}, len(c.Payload.Entries))
	for i, entry := range c.Payload.Entries {
		if entry.Kind != "static" && entry.Kind != "template" {
			return nil, fmt.Errorf("unsupported payload entry kind %q", entry.Kind)
		}
		if err := validateLogicalPath(entry.Path); err != nil {
			return nil, fmt.Errorf("payload path %q: %w", entry.Path, err)
		}
		if i > 0 && !(previous < entry.Path) {
			return nil, errors.New("payload entries are not strictly UTF-8 sorted")
		}
		previous = entry.Path
		if err := addLogicalPath(seen, entry.Path); err != nil {
			return nil, err
		}
		if !isLowerHex(entry.SHA256) || entry.Size < 0 || entry.Size > maxPayloadFileBytes {
			return nil, fmt.Errorf("invalid payload metadata for %q", entry.Path)
		}
		if _, ok := seen[path.Dir(entry.Path)]; path.Dir(entry.Path) != "." && !ok {
			return nil, fmt.Errorf("payload parent directory is undeclared: %q", entry.Path)
		}
		data, err := readLimitedFile(assets, "payload/"+entry.Path, maxPayloadFileBytes)
		if err != nil {
			return nil, fmt.Errorf("payload %q: %w", entry.Path, err)
		}
		if int64(len(data)) != entry.Size || sha256Hex(data) != entry.SHA256 {
			return nil, fmt.Errorf("payload hash or size mismatch for %q", entry.Path)
		}
		total += int64(len(data))
		if total > maxPayloadTotalBytes {
			return nil, errors.New("payload exceeds independent total-byte ceiling")
		}
		if entry.Size > maxFile {
			maxFile = entry.Size
		}
		if len([]byte(entry.Path)) > maxPath {
			maxPath = len([]byte(entry.Path))
		}
		payload[entry.Path] = &fstest.MapFile{Data: append([]byte(nil), data...), Mode: 0o444}
		declaredFiles[entry.Path] = struct{}{}
		allRecords = append(allRecords, digestRecord{entry.Kind, entry.Path, entry.Size, entry.SHA256})
	}
	if err := rejectUnexpectedPayloadEntries(assets, declaredFiles); err != nil {
		return nil, err
	}
	if total != c.Payload.TotalBytes || total != c.Limits.TotalBytes ||
		maxFile != c.Limits.MaxFileBytes || maxPath != c.Limits.MaxLogicalPathBytes {
		return nil, errors.New("payload byte limits do not match inventory")
	}
	if rootDigest(allRecords) != c.Payload.RootDigest {
		return nil, errors.New("payload root digest mismatch")
	}
	return payload, nil
}

func rejectUnexpectedPayloadEntries(assets fs.FS, declared map[string]struct{}) error {
	return fs.WalkDir(assets, "payload", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if name == "payload" || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode()&(fs.ModeSymlink|fs.ModeType) != 0 {
			return fmt.Errorf("payload contains link or special entry %q", name)
		}
		logical := strings.TrimPrefix(name, "payload/")
		if _, ok := declared[logical]; !ok {
			return fmt.Errorf("payload contains undeclared file %q", logical)
		}
		return nil
	})
}

type digestRecord struct {
	kind   string
	path   string
	size   int64
	digest string
}

func rootDigest(records []digestRecord) string {
	sort.Slice(records, func(i, j int) bool { return records[i].path < records[j].path })
	var buffer bytes.Buffer
	for _, record := range records {
		buffer.WriteString(record.kind)
		buffer.WriteByte(0)
		buffer.WriteString(record.path)
		buffer.WriteByte(0)
		buffer.WriteString(strconv.FormatInt(record.size, 10))
		buffer.WriteByte(0)
		buffer.WriteString(record.digest)
		buffer.WriteByte('\n')
	}
	return sha256Hex(buffer.Bytes())
}

func validateLogicalPath(name string) error {
	if name == "" || !utf8.ValidString(name) || !norm.NFC.IsNormalString(name) ||
		len([]byte(name)) > maxLogicalPathBytes || strings.ContainsRune(name, 0) ||
		strings.Contains(name, `\`) || strings.HasPrefix(name, "/") ||
		driveRE.MatchString(name) || path.Clean(name) != name {
		return errors.New("unsafe logical path")
	}
	for _, segment := range strings.Split(name, "/") {
		if segment == "" || segment == "." || segment == ".." ||
			strings.HasSuffix(segment, ".") || strings.HasSuffix(segment, " ") ||
			strings.ContainsAny(segment, `:*?"<>|`) || reservedRE.MatchString(segment) {
			return errors.New("unsafe logical path")
		}
	}
	return nil
}

func addLogicalPath(seen map[string]string, name string) error {
	folded := strings.ToLower(name)
	if previous, ok := seen[folded]; ok {
		if previous == name {
			return fmt.Errorf("duplicate logical path %q", name)
		}
		return fmt.Errorf("case-colliding logical paths %q and %q", previous, name)
	}
	seen[folded] = name
	return nil
}

func isLowerHex(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := scanJSONValue(decoder); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func scanJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("object key is not a string")
			}
			folded := strings.ToLower(key)
			if _, exists := seen[folded]; exists {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			seen[folded] = struct{}{}
			if err := scanJSONValue(decoder); err != nil {
				return err
			}
		}
	case '[':
		for decoder.More() {
			if err := scanJSONValue(decoder); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected closing JSON delimiter")
	}
	_, err = decoder.Token()
	return err
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

// Contract returns an independent value view of verified contract metadata.
func (b Bundle) Contract() Contract {
	if b.data == nil {
		return Contract{}
	}
	raw, _ := json.Marshal(b.data.contract)
	var clone Contract
	_ = json.Unmarshal(raw, &clone)
	return clone
}

// Payload returns a fresh, read-only view of the verified payload subtree.
func (b Bundle) Payload() fs.FS {
	if b.data == nil {
		return readOnlyPayload{fsys: fstest.MapFS{}}
	}
	cloned := make(fstest.MapFS, len(b.data.payload))
	for name, entry := range b.data.payload {
		copyEntry := *entry
		copyEntry.Data = append([]byte(nil), entry.Data...)
		cloned[name] = &copyEntry
	}
	return readOnlyPayload{fsys: cloned}
}

type readOnlyPayload struct {
	fsys fstest.MapFS
}

func (p readOnlyPayload) Open(name string) (fs.File, error) {
	return p.fsys.Open(name)
}
