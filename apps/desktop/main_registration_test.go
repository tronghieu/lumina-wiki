package main

import (
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestRendererRegistersOnlyCapabilityBasedAIService(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var registered []string
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 1 {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "NewService" {
			return true
		}
		pkg, ok := selector.X.(*ast.Ident)
		if !ok || pkg.Name != "application" {
			return true
		}
		switch argument := call.Args[0].(type) {
		case *ast.Ident:
			registered = append(registered, argument.Name)
		case *ast.CallExpr:
			if called, ok := argument.Fun.(*ast.SelectorExpr); ok {
				if owner, ok := called.X.(*ast.Ident); ok {
					registered = append(registered, owner.Name+"."+called.Sel.Name)
				}
			}
		}
		return true
	})
	if len(registered) != 1 || registered[0] != "aiService" {
		t.Fatalf("renderer services = %v, want only aiService", registered)
	}
}

func TestGeneratedBindingsExposeNoRawRootCheckOrImportService(t *testing.T) {
	base := filepath.Join(
		"frontend",
		"bindings",
		"github.com",
		"tronghieu",
		"lumina-wiki",
		"apps",
		"desktop",
		"internal",
	)
	for _, service := range []string{"workspace", "graph", "tools", "importer"} {
		path := filepath.Join(base, service, "service.ts")
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("raw renderer service remains available: %s err=%v", path, err)
		}
	}
	aiBinding := filepath.Join(base, "ai", "service.ts")
	raw, err := os.ReadFile(aiBinding)
	if err != nil {
		t.Fatalf("AI capability binding is unavailable: %v", err)
	}
	for _, forbidden := range []string{
		"ChooseAndActivateWorkspace",
		"ConfirmAndActivateWorkspace",
	} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("raw renderer activation remains available: %s", forbidden)
		}
	}
	for _, match := range regexp.MustCompile(`(?m)^export function [^(]+\(([^)]*)\)`).FindAllStringSubmatch(string(raw), -1) {
		for _, parameter := range strings.Split(match[1], ",") {
			name, _, _ := strings.Cut(strings.TrimSpace(parameter), ":")
			if isRawFilesystemParameter(name) {
				t.Fatalf("generated renderer method exposes raw filesystem parameter %q", name)
			}
		}
	}
}

func TestGeneratedBindingsExposePathlessRecentAndContinuityFacade(t *testing.T) {
	base := filepath.Join(
		"frontend", "bindings", "github.com", "tronghieu", "lumina-wiki",
		"apps", "desktop", "internal", "ai",
	)
	serviceRaw, err := os.ReadFile(filepath.Join(base, "service.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{
		"ListRecentLibraries",
		"PrepareRestoreRecentLibrary",
		"PrepareFindRecentLibrary",
		"SaveWorkspaceView",
		"RemoveRecentLibrary",
		"BeginResetRecentViewState",
		"ResetRecentViewState",
		"ReadWorkspaceNote",
		"LoadLatestHistory",
	} {
		if !strings.Contains(string(serviceRaw), "export function "+method+"(") {
			t.Fatalf("Phase 4 binding is unavailable: %s", method)
		}
	}
	modelsRaw, err := os.ReadFile(filepath.Join(base, "models.ts"))
	if err != nil {
		t.Fatal(err)
	}
	models := string(modelsRaw)
	start := strings.Index(models, "export class RecentLibraryDTO {")
	if start < 0 {
		t.Fatal("RecentLibraryDTO binding is unavailable")
	}
	endOffset := strings.Index(models[start+1:], "\nexport class ")
	if endOffset < 0 {
		t.Fatal("RecentLibraryDTO binding is malformed")
	}
	recentBlock := models[start : start+1+endOffset]
	if forbidden := regexp.MustCompile(`(?i)(canonical.?path|root|locator|signature|token)`).FindString(recentBlock); forbidden != "" {
		t.Fatalf("RecentLibraryDTO exposes filesystem or authority field: %s", forbidden)
	}
}

func TestAIServiceExportsNoRawFilesystemParameters(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("internal", "ai", "*.go"))
	if err != nil {
		t.Fatal(err)
	}
	fileSet := token.NewFileSet()
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fileSet, path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Recv == nil || !function.Name.IsExported() ||
				!receiverIsService(function.Recv) {
				continue
			}
			for _, field := range function.Type.Params.List {
				if opaqueCapabilityType(field.Type) {
					continue
				}
				for _, name := range field.Names {
					if isRawFilesystemParameter(name.Name) {
						t.Fatalf("%s exposes raw filesystem parameter %q", function.Name.Name, name.Name)
					}
				}
			}
		}
	}
}

func receiverIsService(receiver *ast.FieldList) bool {
	if receiver == nil || len(receiver.List) != 1 {
		return false
	}
	receiverType := receiver.List[0].Type
	if pointer, ok := receiverType.(*ast.StarExpr); ok {
		receiverType = pointer.X
	}
	identifier, ok := receiverType.(*ast.Ident)
	return ok && identifier.Name == "Service"
}

func opaqueCapabilityType(expression ast.Expr) bool {
	identifier, ok := expression.(*ast.Ident)
	if !ok {
		return false
	}
	switch identifier.Name {
	case "LocationCapabilityDTO", "SessionReferenceDTO":
		return true
	default:
		return false
	}
}

func isRawFilesystemParameter(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "root") ||
		strings.Contains(lower, "path") ||
		strings.Contains(lower, "directory")
}
