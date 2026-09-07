package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type lexicalToken struct {
	Text   string
	Line   int
	Column int
}

func discoverProtoSymbols(
	root string,
	protoRoots []string,
) (map[string][]sourceLocation, []diagnostic) {
	declarations := make(map[string][]sourceLocation)
	files, diagnostics := collectSourceFiles(root, protoRoots, map[string]struct{}{".proto": {}})
	for _, file := range files {
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(file)))
		if err != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("read proto source %q: %v", file, err),
			})
			continue
		}
		tokens := lexCStyle(content, true)
		packageName := ""
		for index := 0; index < len(tokens); index++ {
			if tokens[index].Text == "package" {
				var parts []string
				for next := index + 1; next < len(tokens); next++ {
					switch tokens[next].Text {
					case ";":
						index = next
						next = len(tokens)
					case ".":
						continue
					default:
						if isIdentifier(tokens[next].Text) {
							parts = append(parts, tokens[next].Text)
						}
					}
				}
				packageName = strings.Join(parts, ".")
				continue
			}
			if tokens[index].Text != "message" &&
				tokens[index].Text != "enum" &&
				tokens[index].Text != "service" {
				continue
			}
			if index+1 >= len(tokens) || !isIdentifier(tokens[index+1].Text) {
				continue
			}
			name := tokens[index+1].Text
			qualified := name
			if packageName != "" {
				qualified = packageName + "." + name
			}
			declarations[qualified] = append(declarations[qualified], sourceLocation{
				File:   file,
				Line:   tokens[index+1].Line,
				Column: tokens[index+1].Column,
			})
		}
	}
	sortLocationMap(declarations)
	return declarations, diagnostics
}

func discoverSupersededSymbols(
	root string,
	sourceRoots []string,
	symbols []string,
) (map[string][]sourceLocation, []diagnostic) {
	locations := make(map[string][]sourceLocation)
	if len(symbols) == 0 {
		return locations, nil
	}

	byBaseName := make(map[string][]string)
	for _, symbol := range symbols {
		baseName := symbol
		if separator := strings.LastIndex(symbol, "."); separator >= 0 {
			baseName = symbol[separator+1:]
		}
		byBaseName[baseName] = append(byBaseName[baseName], symbol)
	}

	extensions := map[string]struct{}{
		".go":    {},
		".proto": {},
		".py":    {},
		".rs":    {},
		".ts":    {},
		".tsx":   {},
	}
	files, diagnostics := collectSourceFiles(root, sourceRoots, extensions)
	for _, file := range files {
		absolutePath := filepath.Join(root, filepath.FromSlash(file))
		content, err := os.ReadFile(absolutePath)
		if err != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("read source %q: %v", file, err),
			})
			continue
		}
		for _, item := range lexRawIdentifiers(content) {
			for _, symbol := range byBaseName[item.Text] {
				locations[symbol] = append(locations[symbol], sourceLocation{
					File: file, Line: item.Line, Column: item.Column,
				})
			}
		}
	}
	sortLocationMap(locations)
	return locations, diagnostics
}

// Superseded symbols are a zero-reference contract. Raw identifier scanning is
// intentional here so stale strings, tests, and comments cannot preserve an old
// protocol name after the hard cut.
func lexRawIdentifiers(content []byte) []lexicalToken {
	tokens := make([]lexicalToken, 0)
	line, column := 1, 1
	for index := 0; index < len(content); {
		if content[index] == '\n' {
			line++
			column = 1
			index++
			continue
		}
		if !isIdentifierStart(content[index]) {
			index++
			column++
			continue
		}
		start, startColumn := index, column
		for index < len(content) && isIdentifierPart(content[index]) {
			index++
			column++
		}
		tokens = append(tokens, lexicalToken{
			Text: string(content[start:index]), Line: line, Column: startColumn,
		})
	}
	return tokens
}

func discoverForbiddenTruthStores(
	root string,
	stationRoots []string,
	stores []string,
) (map[string][]sourceLocation, []diagnostic) {
	locations := make(map[string][]sourceLocation)
	if len(stores) == 0 {
		return locations, nil
	}
	forbidden := make(map[string]struct{}, len(stores))
	for _, store := range stores {
		forbidden[store] = struct{}{}
	}

	files, diagnostics := collectSourceFiles(root, stationRoots, map[string]struct{}{".go": {}})
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		absolutePath := filepath.Join(root, filepath.FromSlash(file))
		content, readErr := os.ReadFile(absolutePath)
		if readErr != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:      "source_inventory_failed",
				Message:   fmt.Sprintf("read Go source %q: %v", file, readErr),
				Locations: []sourceLocation{{File: file, Line: 1, Column: 1}},
			})
			continue
		}
		fileSet := token.NewFileSet()
		parsed, err := parser.ParseFile(
			fileSet,
			file,
			content,
			parser.SkipObjectResolution,
		)
		if err != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:      "go_ast_parse_failed",
				Message:   fmt.Sprintf("parse Go source %q: %v", file, err),
				Locations: []sourceLocation{{File: file, Line: 1, Column: 1}},
			})
			continue
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			literal, ok := node.(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			value, decodeErr := strconv.Unquote(literal.Value)
			if decodeErr != nil {
				return true
			}
			position := fileSet.Position(literal.Pos())
			for store := range forbidden {
				if !containsIdentifier(value, store) {
					continue
				}
				locations[store] = append(locations[store], sourceLocation{
					File: file, Line: position.Line, Column: position.Column,
				})
			}
			return true
		})
	}
	sortLocationMap(locations)
	return locations, diagnostics
}

func discoverForbiddenDDDImports(
	root string,
	rules []dddLayerRule,
) []diagnostic {
	var diagnostics []diagnostic
	for _, rule := range rules {
		// A configured root is part of the Gate contract; treating a missing path
		// as an empty layer would silently disable import enforcement.
		if rootDiagnostic := unavailableDDDLayerRootDiagnostic(root, rule); rootDiagnostic != nil {
			diagnostics = append(diagnostics, *rootDiagnostic)
			continue
		}
		files, sourceDiagnostics := collectSourceFiles(
			root,
			[]string{rule.Root},
			map[string]struct{}{".go": {}},
		)
		diagnostics = append(diagnostics, sourceDiagnostics...)
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") {
				continue
			}
			content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(file)))
			if err != nil {
				diagnostics = append(diagnostics, diagnostic{
					Code:      "source_inventory_failed",
					Message:   fmt.Sprintf("read Go source %q: %v", file, err),
					Locations: []sourceLocation{{File: file, Line: 1, Column: 1}},
				})
				continue
			}
			fileSet := token.NewFileSet()
			parsed, err := parser.ParseFile(
				fileSet,
				file,
				content,
				parser.ImportsOnly,
			)
			if err != nil {
				diagnostics = append(diagnostics, diagnostic{
					Code:      "go_ast_parse_failed",
					Message:   fmt.Sprintf("parse Go imports in %q: %v", file, err),
					Locations: []sourceLocation{{File: file, Line: 1, Column: 1}},
				})
				continue
			}
			for _, importSpec := range parsed.Imports {
				importPath, decodeErr := strconv.Unquote(importSpec.Path.Value)
				if decodeErr != nil {
					continue
				}
				for _, forbidden := range rule.ForbiddenImports {
					if !importMatchesPrefix(importPath, forbidden) {
						continue
					}
					position := fileSet.Position(importSpec.Path.Pos())
					diagnostics = append(diagnostics, diagnostic{
						Code:       "forbidden_ddd_import",
						Message:    fmt.Sprintf("DDD layer %q imports forbidden package %q", rule.Name, importPath),
						Identifier: importPath,
						Owner:      rule.Name,
						Expected:   []string{rule.Root},
						Locations: []sourceLocation{{
							File: file, Line: position.Line, Column: position.Column,
						}},
					})
					break
				}
			}
		}
	}
	return diagnostics
}

func unavailableDDDLayerRootDiagnostic(root string, rule dddLayerRule) *diagnostic {
	normalizedRoot, err := normalizeRepoPath(rule.Root)
	if err != nil {
		return nil
	}

	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(normalizedRoot)))
	if err == nil && info.IsDir() {
		return nil
	}
	if err != nil && !os.IsNotExist(err) {
		return nil
	}

	reason := "does not exist"
	if err == nil {
		reason = "is not a directory"
	}
	return &diagnostic{
		Code:       "missing_ddd_layer_root",
		Message:    fmt.Sprintf("DDD layer %q root %q %s", rule.Name, normalizedRoot, reason),
		Identifier: normalizedRoot,
		Owner:      rule.Name,
		Expected:   []string{normalizedRoot},
	}
}

func importMatchesPrefix(importPath, prefix string) bool {
	return importPath == prefix || strings.HasPrefix(importPath, prefix+"/")
}

func containsIdentifier(value, identifier string) bool {
	for start := 0; start < len(value); {
		offset := strings.Index(value[start:], identifier)
		if offset < 0 {
			return false
		}
		offset += start
		leftBoundary := offset == 0 || !isIdentifierPart(value[offset-1])
		end := offset + len(identifier)
		rightBoundary := end == len(value) || !isIdentifierPart(value[end])
		if leftBoundary && rightBoundary {
			return true
		}
		start = offset + 1
	}
	return false
}

func collectSourceFiles(
	root string,
	searchRoots []string,
	extensions map[string]struct{},
) ([]string, []diagnostic) {
	seen := make(map[string]struct{})
	var files []string
	var diagnostics []diagnostic
	for _, searchRoot := range searchRoots {
		normalizedRoot, err := normalizeRepoPath(searchRoot)
		if err != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("invalid source root %q: %v", searchRoot, err),
			})
			continue
		}
		absoluteRoot := filepath.Join(root, filepath.FromSlash(normalizedRoot))
		info, statErr := os.Stat(absoluteRoot)
		if statErr != nil {
			if os.IsNotExist(statErr) {
				continue
			}
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("inspect source root %q: %v", normalizedRoot, statErr),
			})
			continue
		}
		if !info.IsDir() {
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("source root %q is not a directory", normalizedRoot),
			})
			continue
		}
		walkErr := filepath.WalkDir(absoluteRoot, func(path string, entry fs.DirEntry, entryErr error) error {
			if entryErr != nil {
				return entryErr
			}
			if entry.IsDir() {
				if shouldSkipDirectory(entry.Name()) && path != absoluteRoot {
					return filepath.SkipDir
				}
				return nil
			}
			if _, accepted := extensions[filepath.Ext(entry.Name())]; !accepted {
				return nil
			}
			relativePath, relErr := filepath.Rel(root, path)
			if relErr != nil {
				return relErr
			}
			relativePath = filepath.ToSlash(relativePath)
			if _, exists := seen[relativePath]; exists {
				return nil
			}
			seen[relativePath] = struct{}{}
			files = append(files, relativePath)
			return nil
		})
		if walkErr != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("walk source root %q: %v", normalizedRoot, walkErr),
			})
		}
	}
	sort.Strings(files)
	return files, diagnostics
}

func sortLocationMap(values map[string][]sourceLocation) {
	for key := range values {
		sort.Slice(values[key], func(i, j int) bool {
			left, right := values[key][i], values[key][j]
			if left.File != right.File {
				return left.File < right.File
			}
			if left.Line != right.Line {
				return left.Line < right.Line
			}
			return left.Column < right.Column
		})
		values[key] = deduplicateLocations(values[key])
	}
}

func deduplicateLocations(values []sourceLocation) []sourceLocation {
	if len(values) < 2 {
		return values
	}
	result := values[:1]
	for _, value := range values[1:] {
		last := result[len(result)-1]
		if value != last {
			result = append(result, value)
		}
	}
	return result
}

func lexCStyle(content []byte, punctuation bool) []lexicalToken {
	tokens := make([]lexicalToken, 0)
	line, column := 1, 1
	for index := 0; index < len(content); {
		current := content[index]
		if current == '\n' {
			line++
			column = 1
			index++
			continue
		}
		if current == '/' && index+1 < len(content) && content[index+1] == '/' {
			index += 2
			column += 2
			for index < len(content) && content[index] != '\n' {
				index++
				column++
			}
			continue
		}
		if current == '/' && index+1 < len(content) && content[index+1] == '*' {
			index += 2
			column += 2
			for index < len(content) {
				if content[index] == '\n' {
					line++
					column = 1
					index++
					continue
				}
				if content[index] == '*' && index+1 < len(content) && content[index+1] == '/' {
					index += 2
					column += 2
					break
				}
				index++
				column++
			}
			continue
		}
		if current == '#' {
			for index < len(content) && content[index] != '\n' {
				index++
				column++
			}
			continue
		}
		if current == '"' || current == '\'' || current == '`' {
			quote := current
			index++
			column++
			for index < len(content) {
				if content[index] == '\n' {
					line++
					column = 1
					index++
					if quote != '`' {
						break
					}
					continue
				}
				if content[index] == '\\' && quote != '`' && index+1 < len(content) {
					index += 2
					column += 2
					continue
				}
				if content[index] == quote {
					index++
					column++
					break
				}
				index++
				column++
			}
			continue
		}
		if isIdentifierStart(current) {
			start, startColumn := index, column
			for index < len(content) && isIdentifierPart(content[index]) {
				index++
				column++
			}
			tokens = append(tokens, lexicalToken{
				Text: string(content[start:index]), Line: line, Column: startColumn,
			})
			continue
		}
		if punctuation && (current == '.' || current == ';') {
			tokens = append(tokens, lexicalToken{
				Text: string(current), Line: line, Column: column,
			})
		}
		index++
		column++
	}
	return tokens
}

func isIdentifier(value string) bool {
	if value == "" || !isIdentifierStart(value[0]) {
		return false
	}
	for index := 1; index < len(value); index++ {
		if !isIdentifierPart(value[index]) {
			return false
		}
	}
	return true
}

func isIdentifierStart(value byte) bool {
	return value == '_' ||
		(value >= 'a' && value <= 'z') ||
		(value >= 'A' && value <= 'Z')
}

func isIdentifierPart(value byte) bool {
	return isIdentifierStart(value) || (value >= '0' && value <= '9')
}
