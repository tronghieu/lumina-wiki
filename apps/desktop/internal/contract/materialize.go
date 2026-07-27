package contract

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tronghieu/lumina-wiki/apps/desktop/internal/rootproof"
)

// RuntimeInputs is the complete runtime-derived materialization boundary.
type RuntimeInputs struct {
	ProjectName string
	Now         time.Time
	Root        rootproof.RootProof
}

const (
	maxProjectNameBytes       = 255
	maxMaterializedFileBytes  = 8 * 1024 * 1024
	maxMaterializedTotalBytes = 96 * 1024 * 1024
	maxMaterializedFiles      = maxPayloadFiles + 4
)

// File is one target-ready materialized file. Its bytes are copy-on-read.
type File struct {
	Path   string
	Kind   string
	SHA256 string
	data   []byte
}

// Bytes returns an independent copy of the materialized bytes.
func (f File) Bytes() []byte {
	return append([]byte(nil), f.data...)
}

// Materialized is an immutable target-ready directory and file inventory.
type Materialized struct {
	directories []string
	files       []File
}

// Directories returns an independent, sorted directory inventory.
func (m Materialized) Directories() []string {
	return append([]string(nil), m.directories...)
}

// Files returns an independent inventory whose Bytes methods also copy.
func (m Materialized) Files() []File {
	result := make([]File, len(m.files))
	for i, file := range m.files {
		result[i] = file
		result[i].data = append([]byte(nil), file.data...)
	}
	return result
}

// ReadFile returns independent bytes for path.
func (m Materialized) ReadFile(name string) ([]byte, bool) {
	index := sort.Search(len(m.files), func(i int) bool { return m.files[i].Path >= name })
	if index >= len(m.files) || m.files[index].Path != name {
		return nil, false
	}
	return append([]byte(nil), m.files[index].data...), true
}

var (
	conditionalRE = regexp.MustCompile(`(?s)\{\{#if ([^}]+)\}\}\n?(.*?)\{\{/if\}\}\n?`)
	variableRE    = regexp.MustCompile(`\{\{([^#/}][^}]*)\}\}`)
)

// Materialize derives target-ready bytes without writing files or executing
// external processes.
func (b Bundle) Materialize(input RuntimeInputs) (Materialized, error) {
	if b.data == nil {
		return Materialized{}, errors.New("contract bundle is absent")
	}
	if input.ProjectName == "" || !utf8.ValidString(input.ProjectName) ||
		len([]byte(input.ProjectName)) > maxProjectNameBytes ||
		strings.IndexByte(input.ProjectName, 0) >= 0 {
		return Materialized{}, errors.New("project name must be non-empty valid Unicode")
	}
	if input.Now.IsZero() || input.Now.Year() < 0 || input.Now.Year() > 9999 {
		return Materialized{}, errors.New("runtime instant is invalid")
	}
	if err := input.Root.Validate(); err != nil {
		return Materialized{}, fmt.Errorf("runtime root: %w", err)
	}
	rootPath := input.Root.Path()
	if rootPath == "" {
		return Materialized{}, errors.New("runtime root is unavailable")
	}

	instant := input.Now.UTC()
	variables := map[string]any{
		"project_name":             input.ProjectName,
		"locale":                   b.data.contract.Profile.Locale,
		"communication_language":   b.data.contract.Profile.CommunicationLang,
		"document_output_language": b.data.contract.Profile.DocumentOutputLang,
		"pack_core":                true,
		"pack_research":            false,
		"pack_reading":             false,
		"pack_learning":            false,
		"created_at":               instant.Format("2006-01-02"),
		"schema_version":           strconv.Itoa(b.data.contract.Versions.ManifestSchema),
	}

	accumulator := materializationAccumulator{
		files: make(map[string]File, len(b.data.contract.Payload.Entries)+4),
		paths: make(map[string]string, len(b.data.contract.Payload.Entries)+4),
	}
	payloadFS := b.Payload()
	for _, entry := range b.data.contract.Payload.Entries {
		data, err := readLimitedFile(payloadFS, entry.Path, maxPayloadFileBytes)
		if err != nil {
			return Materialized{}, fmt.Errorf("verified payload %q: %w", entry.Path, err)
		}
		kind := entry.Kind
		if entry.Kind == "template" {
			if err := accumulator.add(newFile(entry.Path, entry.Kind, data), ""); err != nil {
				return Materialized{}, err
			}
			rendered, err := renderTemplate(string(data), variables, maxMaterializedFileBytes)
			if err != nil {
				return Materialized{}, fmt.Errorf("render template %q: %w", entry.Path, err)
			}
			kind = "rendered"
			if entry.Path == "README.md" {
				rendered, err = renderReadme(
					rendered, variables, b.data.contract.Materialization.Render.Readme,
					maxMaterializedFileBytes,
				)
				if err != nil {
					return Materialized{}, fmt.Errorf("render README: %w", err)
				}
			}
			data = []byte(rendered)
			if err := accumulator.add(newFile(entry.Path, kind, data), entry.Path); err != nil {
				return Materialized{}, err
			}
			continue
		}
		if err := accumulator.add(newFile(entry.Path, kind, data), ""); err != nil {
			return Materialized{}, err
		}
	}

	configBytes, err := materializeConfig(b.data.contract.Materialization, input.ProjectName, instant)
	if err != nil {
		return Materialized{}, err
	}
	if err := accumulator.add(newFile(
		"_lumina/config/lumina.config.yaml", "state", configBytes,
	), ""); err != nil {
		return Materialized{}, err
	}

	manifestBytes, err := materializeManifest(b.data.contract.Materialization, rootPath, instant)
	if err != nil {
		return Materialized{}, err
	}
	if err := accumulator.add(newFile("_lumina/manifest.json", "state", manifestBytes), ""); err != nil {
		return Materialized{}, err
	}

	skillsBytes := serializeSkillsCSV(b.data.contract.Materialization.State.SkillsCSV)
	if err := accumulator.add(newFile(
		"_lumina/_state/skills-manifest.csv", "state", skillsBytes,
	), ""); err != nil {
		return Materialized{}, err
	}

	filesCSV, err := serializeFilesCSV(
		b.data.contract.State.ManagedFilePaths,
		accumulator.files,
		b.data.contract.Materialization.State.FilesCSV,
	)
	if err != nil {
		return Materialized{}, err
	}
	if err := accumulator.add(newFile(
		"_lumina/_state/files-manifest.csv", "state", filesCSV,
	), ""); err != nil {
		return Materialized{}, err
	}

	result := Materialized{
		directories: append([]string(nil), b.data.contract.Directories...),
		files:       make([]File, 0, len(accumulator.files)),
	}
	for _, file := range accumulator.files {
		result.files = append(result.files, file)
	}
	sort.Slice(result.files, func(i, j int) bool { return result.files[i].Path < result.files[j].Path })
	return result, nil
}

func newFile(name, kind string, data []byte) File {
	copyData := append([]byte(nil), data...)
	return File{Path: name, Kind: kind, SHA256: sha256Hex(copyData), data: copyData}
}

type materializationAccumulator struct {
	files map[string]File
	paths map[string]string
	total int64
}

func (accumulator *materializationAccumulator) add(file File, replaceExact string) error {
	if len(file.data) > maxMaterializedFileBytes {
		return fmt.Errorf("materialized file exceeds byte ceiling: %q", file.Path)
	}
	previous, exists := accumulator.files[file.Path]
	folded := strings.ToLower(file.Path)
	if previousPath, pathExists := accumulator.paths[folded]; pathExists && previousPath != file.Path {
		return fmt.Errorf("case-colliding materialized output paths %q and %q", previousPath, file.Path)
	}
	if exists && replaceExact != file.Path {
		return fmt.Errorf("materialized output path collision: %q", file.Path)
	}
	if !exists && replaceExact != "" {
		return fmt.Errorf("declared materialized replacement is absent: %q", file.Path)
	}
	nextTotal := accumulator.total + int64(len(file.data))
	if exists {
		nextTotal -= int64(len(previous.data))
	}
	if nextTotal > maxMaterializedTotalBytes {
		return errors.New("materialized output exceeds total-byte ceiling")
	}
	if !exists && len(accumulator.files) >= maxMaterializedFiles {
		return errors.New("materialized output exceeds file-count ceiling")
	}
	accumulator.files[file.Path] = file
	accumulator.paths[folded] = file.Path
	accumulator.total = nextTotal
	return nil
}

func renderTemplate(template string, variables map[string]any, limit int) (string, error) {
	normalized := strings.ReplaceAll(strings.ReplaceAll(template, "\r\n", "\n"), "\r", "\n")
	withBlocks := conditionalRE.ReplaceAllStringFunc(normalized, func(block string) string {
		match := conditionalRE.FindStringSubmatch(block)
		if len(match) != 3 {
			return ""
		}
		if truthy(variables[strings.TrimSpace(match[1])]) {
			return match[2]
		}
		return ""
	})
	var output strings.Builder
	remaining := withBlocks
	for {
		match := variableRE.FindStringSubmatchIndex(remaining)
		if match == nil {
			if err := appendBoundedString(&output, remaining, limit); err != nil {
				return "", err
			}
			return output.String(), nil
		}
		if err := appendBoundedString(&output, remaining[:match[0]], limit); err != nil {
			return "", err
		}
		value, ok := variables[strings.TrimSpace(remaining[match[2]:match[3]])]
		if ok && value != nil {
			if err := appendBoundedString(&output, fmt.Sprint(value), limit); err != nil {
				return "", err
			}
		}
		remaining = remaining[match[1]:]
	}
}

func appendBoundedString(output *strings.Builder, value string, limit int) error {
	if len(value) > limit-output.Len() {
		return errors.New("rendered output exceeds byte ceiling")
	}
	output.WriteString(value)
	return nil
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return typed != ""
	default:
		return true
	}
}

func renderReadme(rendered string, variables map[string]any, recipe ReadmeRecipe, limit int) (string, error) {
	lines := strings.Split(rendered, "\n")
	marker := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == "<!-- lumina:schema -->" {
			marker = i
			break
		}
	}
	if marker < 0 {
		title := fmt.Sprint(variables["project_name"])
		if title == "" {
			title = "My Wiki"
		}
		body := []string{
			"# " + title, "", recipe.Heading, "", recipe.DefaultPurpose, "",
			"<!-- lumina:schema -->", rendered, "<!-- /lumina:schema -->",
		}
		result := strings.Join(body, "\n") + "\n"
		if len(result) > limit {
			return "", errors.New("rendered output exceeds byte ceiling")
		}
		return result, nil
	}
	purpose := strings.TrimSpace(recipe.Purpose)
	if purpose == "" {
		purpose = recipe.DefaultPurpose
	}
	insert := []string{"", recipe.Heading, "", purpose, ""}
	lines = append(lines[:marker], append(insert, lines[marker:]...)...)
	result := strings.Join(lines, "\n")
	if len(result) > limit {
		return "", errors.New("rendered output exceeds byte ceiling")
	}
	return result, nil
}

func materializeConfig(recipe Materialization, projectName string, now time.Time) ([]byte, error) {
	var config map[string]any
	if err := json.Unmarshal(recipe.Config, &config); err != nil {
		return nil, fmt.Errorf("decode materialization config: %w", err)
	}
	config["project_name"] = projectName
	config["created_at"] = now.Format("2006-01-02")
	var output strings.Builder
	output.WriteString(strings.Join(recipe.Serialization.Config.Header, "\n"))
	output.WriteByte('\n')
	if err := appendYAMLMap(&output, config, 0); err != nil {
		return nil, err
	}
	return []byte(output.String()), nil
}

func appendYAMLMap(output *strings.Builder, value map[string]any, indent int) error {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	padding := strings.Repeat(" ", indent)
	for _, key := range keys {
		item := value[key]
		output.WriteString(padding)
		output.WriteString(key)
		switch typed := item.(type) {
		case map[string]any:
			output.WriteString(":\n")
			if err := appendYAMLMap(output, typed, indent+2); err != nil {
				return err
			}
		case []any:
			output.WriteString(":\n")
			for _, element := range typed {
				output.WriteString(strings.Repeat(" ", indent+2))
				output.WriteString("- ")
				scalar, err := yamlScalar(element)
				if err != nil {
					return err
				}
				output.WriteString(scalar)
				output.WriteByte('\n')
			}
		default:
			scalar, err := yamlScalar(typed)
			if err != nil {
				return err
			}
			output.WriteString(": ")
			output.WriteString(scalar)
			output.WriteByte('\n')
		}
	}
	return nil
}

func yamlScalar(value any) (string, error) {
	switch typed := value.(type) {
	case string:
		var buffer bytes.Buffer
		encoder := json.NewEncoder(&buffer)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(typed); err != nil {
			return "", err
		}
		return strings.TrimSuffix(buffer.String(), "\n"), nil
	case bool:
		return strconv.FormatBool(typed), nil
	case float64:
		return strconv.FormatFloat(typed, 'g', -1, 64), nil
	case nil:
		return "null", nil
	default:
		return "", fmt.Errorf("unsupported YAML scalar %T", value)
	}
}

func materializeManifest(recipe Materialization, rootPath string, now time.Time) ([]byte, error) {
	var manifest map[string]any
	if err := json.Unmarshal(recipe.Manifest, &manifest); err != nil {
		return nil, fmt.Errorf("decode materialization manifest: %w", err)
	}
	timestamp := now.Format(time.RFC3339Nano)
	manifest["installedAt"] = timestamp
	manifest["updatedAt"] = timestamp
	manifest["resolvedPaths"] = map[string]any{
		"agents":      filepath.Join(rootPath, ".agents"),
		"lumina":      filepath.Join(rootPath, "_lumina"),
		"projectRoot": rootPath,
		"raw":         filepath.Join(rootPath, "raw"),
		"wiki":        filepath.Join(rootPath, "wiki"),
	}
	return canonicalJSON(manifest)
}

func canonicalJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func serializeSkillsCSV(recipe SkillsCSVRecipe) []byte {
	var output strings.Builder
	output.WriteString(strings.Join(recipe.Columns, ","))
	output.WriteByte('\n')
	for _, row := range recipe.Rows {
		values := map[string]string{
			"canonical_id": row.CanonicalID, "display_name": row.DisplayName,
			"pack": row.Pack, "source": row.Source, "relative_path": row.RelativePath,
			"target_link_path": row.TargetLinkPath, "version": row.Version,
		}
		writeCSVRow(&output, recipe.Columns, values)
	}
	return []byte(output.String())
}

func serializeFilesCSV(paths []string, files map[string]File, recipe FilesCSVRecipe) ([]byte, error) {
	var output strings.Builder
	output.WriteString(strings.Join(recipe.Columns, ","))
	output.WriteByte('\n')
	for _, name := range paths {
		file, ok := files[name]
		if !ok {
			return nil, fmt.Errorf("managed target is absent: %q", name)
		}
		writeCSVRow(&output, recipe.Columns, map[string]string{
			"relative_path": name, "sha256": file.SHA256,
			"source_pack": recipe.SourcePack, "installed_version": recipe.InstalledVersion,
		})
	}
	return []byte(output.String()), nil
}

func writeCSVRow(output *strings.Builder, columns []string, values map[string]string) {
	for i, column := range columns {
		if i > 0 {
			output.WriteByte(',')
		}
		output.WriteString(escapeCSV(values[column]))
	}
	output.WriteByte('\n')
}

func escapeCSV(value string) string {
	if !strings.ContainsAny(value, ",\"\r\n") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
