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

const stationServerImport = "github.com/peers-labs/peers-touch/station/frame/core/server"

var handlerConstructors = map[string]struct{}{
	"NewHandler":                  {},
	"NewHandlerWithURL":           {},
	"NewHertzHandler":             {},
	"NewHTTPHandler":              {},
	"NewSimpleHandler":            {},
	"NewStrictTypedHandler":       {},
	"NewTypedHandler":             {},
	"NewCanonicalProtobufHandler": {},
}

type parsedGoFile struct {
	AST        *ast.File
	FileSet    *token.FileSet
	Imports    map[string]string
	PackageKey string
	Path       string
}

type constantResolver struct {
	cache       map[string]string
	definitions map[string]ast.Expr
	resolving   map[string]bool
}

func discoverRoutes(
	root string,
	registrationRoots []string,
) ([]discoveredRoute, []diagnostic, int) {
	files, parseDiagnostics, parsedCount := parseGoFiles(root, registrationRoots)
	resolvers := buildConstantResolvers(files)
	routes := make([]discoveredRoute, 0)

	for _, file := range files {
		resolver := resolvers[file.PackageKey]
		ast.Inspect(file.AST, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			constructor, ok := handlerConstructor(call.Fun, file.Imports, file.AST.Name.Name)
			if !ok {
				return true
			}
			route, ok := routeFromCall(call, constructor, file, resolver)
			if ok {
				routes = append(routes, route)
			}
			return true
		})
	}

	sort.Slice(routes, func(i, j int) bool {
		left, right := routes[i], routes[j]
		if left.Method != right.Method {
			return left.Method < right.Method
		}
		if left.Path != right.Path {
			return left.Path < right.Path
		}
		if left.Source.File != right.Source.File {
			return left.Source.File < right.Source.File
		}
		if left.Source.Line != right.Source.Line {
			return left.Source.Line < right.Source.Line
		}
		if left.Source.Column != right.Source.Column {
			return left.Source.Column < right.Source.Column
		}
		return left.Name < right.Name
	})
	return routes, parseDiagnostics, parsedCount
}

func parseGoFiles(
	root string,
	searchRoots []string,
) ([]parsedGoFile, []diagnostic, int) {
	fileSet := token.NewFileSet()
	seen := make(map[string]struct{})
	paths := make([]string, 0)
	var diagnostics []diagnostic

	for _, searchRoot := range searchRoots {
		absoluteRoot := filepath.Join(root, filepath.FromSlash(searchRoot))
		err := filepath.WalkDir(absoluteRoot, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if shouldSkipDirectory(entry.Name()) && path != absoluteRoot {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(entry.Name(), ".go") ||
				strings.HasSuffix(entry.Name(), "_test.go") ||
				strings.HasSuffix(entry.Name(), ".pb.go") {
				return nil
			}
			cleanPath := filepath.Clean(path)
			if _, exists := seen[cleanPath]; exists {
				return nil
			}
			seen[cleanPath] = struct{}{}
			paths = append(paths, cleanPath)
			return nil
		})
		if err != nil {
			relativeRoot := filepath.ToSlash(searchRoot)
			diagnostics = append(diagnostics, diagnostic{
				Code:    "source_inventory_failed",
				Message: fmt.Sprintf("walk registration root %q: %v", relativeRoot, err),
			})
		}
	}
	sort.Strings(paths)

	files := make([]parsedGoFile, 0, len(paths))
	for _, path := range paths {
		relativePath, relErr := filepath.Rel(root, path)
		if relErr != nil {
			relativePath = path
		}
		relativePath = filepath.ToSlash(relativePath)
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:      "source_inventory_failed",
				Message:   fmt.Sprintf("read Go source %q: %v", relativePath, readErr),
				Locations: []sourceLocation{{File: relativePath, Line: 1, Column: 1}},
			})
			continue
		}
		parsed, err := parser.ParseFile(
			fileSet,
			relativePath,
			content,
			parser.AllErrors|parser.SkipObjectResolution,
		)
		if err != nil {
			diagnostics = append(diagnostics, diagnostic{
				Code:      "go_ast_parse_failed",
				Message:   fmt.Sprintf("parse Go source %q: %v", relativePath, err),
				Locations: []sourceLocation{{File: relativePath, Line: 1, Column: 1}},
			})
			continue
		}
		files = append(files, parsedGoFile{
			AST:        parsed,
			FileSet:    fileSet,
			Imports:    importAliases(parsed),
			PackageKey: filepath.ToSlash(filepath.Dir(relativePath)) + ":" + parsed.Name.Name,
			Path:       relativePath,
		})
	}

	return files, diagnostics, len(files)
}

func buildConstantResolvers(files []parsedGoFile) map[string]*constantResolver {
	resolvers := make(map[string]*constantResolver)
	for _, file := range files {
		resolver := resolvers[file.PackageKey]
		if resolver == nil {
			resolver = &constantResolver{
				cache:       make(map[string]string),
				definitions: make(map[string]ast.Expr),
				resolving:   make(map[string]bool),
			}
			resolvers[file.PackageKey] = resolver
		}
		for _, declaration := range file.AST.Decls {
			gen, ok := declaration.(*ast.GenDecl)
			if !ok || (gen.Tok != token.CONST && gen.Tok != token.VAR) {
				continue
			}
			var inherited []ast.Expr
			for _, spec := range gen.Specs {
				valueSpec, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				values := valueSpec.Values
				if gen.Tok == token.CONST && len(values) == 0 {
					values = inherited
				}
				if len(valueSpec.Values) > 0 {
					inherited = valueSpec.Values
				}
				for index, name := range valueSpec.Names {
					if len(values) == 0 {
						continue
					}
					valueIndex := index
					if valueIndex >= len(values) {
						valueIndex = len(values) - 1
					}
					resolver.definitions[name.Name] = values[valueIndex]
				}
			}
		}
	}
	return resolvers
}

func importAliases(file *ast.File) map[string]string {
	aliases := make(map[string]string)
	for _, item := range file.Imports {
		importPath, err := strconv.Unquote(item.Path.Value)
		if err != nil {
			continue
		}
		name := filepath.Base(importPath)
		if item.Name != nil {
			name = item.Name.Name
		}
		aliases[name] = importPath
	}
	return aliases
}

func handlerConstructor(
	expression ast.Expr,
	imports map[string]string,
	packageName string,
) (string, bool) {
	expression = unwrapGenericExpression(expression)
	switch function := expression.(type) {
	case *ast.SelectorExpr:
		receiver, ok := function.X.(*ast.Ident)
		if !ok || imports[receiver.Name] != stationServerImport {
			return "", false
		}
		if _, ok := handlerConstructors[function.Sel.Name]; !ok {
			return "", false
		}
		return function.Sel.Name, true
	case *ast.Ident:
		if packageName != "server" {
			return "", false
		}
		if _, ok := handlerConstructors[function.Name]; !ok {
			return "", false
		}
		return function.Name, true
	default:
		return "", false
	}
}

func unwrapGenericExpression(expression ast.Expr) ast.Expr {
	switch value := expression.(type) {
	case *ast.IndexExpr:
		return unwrapGenericExpression(value.X)
	case *ast.IndexListExpr:
		return unwrapGenericExpression(value.X)
	case *ast.ParenExpr:
		return unwrapGenericExpression(value.X)
	default:
		return expression
	}
}

func routeFromCall(
	call *ast.CallExpr,
	constructor string,
	file parsedGoFile,
	resolver *constantResolver,
) (discoveredRoute, bool) {
	var nameExpression, pathExpression, methodExpression ast.Expr
	switch constructor {
	case "NewTypedHandler", "NewStrictTypedHandler", "NewCanonicalProtobufHandler",
		"NewHTTPHandler", "NewSimpleHandler", "NewHertzHandler":
		if len(call.Args) < 3 {
			return discoveredRoute{}, false
		}
		nameExpression, pathExpression, methodExpression = call.Args[0], call.Args[1], call.Args[2]
	case "NewHandler":
		if len(call.Args) < 3 {
			return discoveredRoute{}, false
		}
		nameExpression, pathExpression, methodExpression = call.Args[0], call.Args[1], call.Args[2]
	case "NewHandlerWithURL":
		if len(call.Args) < 1 {
			return discoveredRoute{}, false
		}
		name, routePath, ok := routerURLValues(call.Args[0], resolver)
		if !ok {
			return discoveredRoute{}, false
		}
		method := "GET"
		for _, argument := range call.Args[2:] {
			optionCall, ok := argument.(*ast.CallExpr)
			if !ok || len(optionCall.Args) != 1 {
				continue
			}
			optionName, optionOK := serverSelectorName(optionCall.Fun, file.Imports)
			if !optionOK || optionName != "WithMethod" {
				continue
			}
			if resolvedMethod, resolved := evalMethod(optionCall.Args[0], file.Imports, resolver); resolved {
				method = resolvedMethod
			}
		}
		position := file.FileSet.Position(call.Pos())
		return discoveredRoute{
			Method:   method,
			Path:     routePath,
			Name:     name,
			Source:   sourceLocation{File: file.Path, Line: position.Line, Column: position.Column},
			Function: constructor,
		}, true
	default:
		return discoveredRoute{}, false
	}

	name, _ := resolver.evalString(nameExpression)
	routePath, pathOK := resolver.evalString(pathExpression)
	method, methodOK := evalMethod(methodExpression, file.Imports, resolver)
	if !pathOK || !methodOK {
		return discoveredRoute{}, false
	}
	normalizedPath, err := normalizeRoutePath(routePath)
	if err != nil {
		return discoveredRoute{}, false
	}
	position := file.FileSet.Position(call.Pos())
	return discoveredRoute{
		Method:   method,
		Path:     normalizedPath,
		Name:     name,
		Source:   sourceLocation{File: file.Path, Line: position.Line, Column: position.Column},
		Function: constructor,
	}, true
}

func serverSelectorName(expression ast.Expr, imports map[string]string) (string, bool) {
	selector, ok := unwrapGenericExpression(expression).(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	receiver, ok := selector.X.(*ast.Ident)
	if !ok || imports[receiver.Name] != stationServerImport {
		return "", false
	}
	return selector.Sel.Name, true
}

func evalMethod(
	expression ast.Expr,
	imports map[string]string,
	resolver *constantResolver,
) (string, bool) {
	if selector, ok := expression.(*ast.SelectorExpr); ok {
		receiver, receiverOK := selector.X.(*ast.Ident)
		if !receiverOK {
			return "", false
		}
		importPath := imports[receiver.Name]
		switch importPath {
		case stationServerImport:
			return normalizeMethodIdentifier(selector.Sel.Name)
		case "net/http":
			return normalizeHTTPMethodIdentifier(selector.Sel.Name)
		}
	}
	if value, ok := resolver.evalString(expression); ok {
		value = strings.ToUpper(strings.TrimSpace(value))
		return value, value != ""
	}
	return "", false
}

func normalizeMethodIdentifier(identifier string) (string, bool) {
	switch identifier {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "ANY":
		return identifier, true
	default:
		return "", false
	}
}

func normalizeHTTPMethodIdentifier(identifier string) (string, bool) {
	if !strings.HasPrefix(identifier, "Method") {
		return "", false
	}
	return normalizeMethodIdentifier(strings.ToUpper(strings.TrimPrefix(identifier, "Method")))
}

func routerURLValues(
	expression ast.Expr,
	resolver *constantResolver,
) (string, string, bool) {
	composite, ok := expression.(*ast.CompositeLit)
	if !ok {
		return "", "", false
	}
	var nameExpression, pathExpression ast.Expr
	for index, element := range composite.Elts {
		if pair, ok := element.(*ast.KeyValueExpr); ok {
			key, keyOK := pair.Key.(*ast.Ident)
			if !keyOK {
				continue
			}
			switch strings.ToLower(key.Name) {
			case "name":
				nameExpression = pair.Value
			case "url", "path", "subpath":
				pathExpression = pair.Value
			}
			continue
		}
		if index == 0 {
			nameExpression = element
		}
		if index == 1 {
			pathExpression = element
		}
	}
	name, nameOK := resolver.evalString(nameExpression)
	routePath, pathOK := resolver.evalString(pathExpression)
	if !nameOK || !pathOK {
		return "", "", false
	}
	normalizedPath, err := normalizeRoutePath(routePath)
	if err != nil {
		return "", "", false
	}
	return name, normalizedPath, true
}

func (r *constantResolver) evalString(expression ast.Expr) (string, bool) {
	if expression == nil {
		return "", false
	}
	switch value := expression.(type) {
	case *ast.BasicLit:
		if value.Kind != token.STRING {
			return "", false
		}
		decoded, err := strconv.Unquote(value.Value)
		return decoded, err == nil
	case *ast.ParenExpr:
		return r.evalString(value.X)
	case *ast.BinaryExpr:
		if value.Op != token.ADD {
			return "", false
		}
		left, leftOK := r.evalString(value.X)
		right, rightOK := r.evalString(value.Y)
		return left + right, leftOK && rightOK
	case *ast.Ident:
		if cached, ok := r.cache[value.Name]; ok {
			return cached, true
		}
		definition, ok := r.definitions[value.Name]
		if !ok || r.resolving[value.Name] {
			return "", false
		}
		r.resolving[value.Name] = true
		resolved, resolvedOK := r.evalString(definition)
		delete(r.resolving, value.Name)
		if resolvedOK {
			r.cache[value.Name] = resolved
		}
		return resolved, resolvedOK
	default:
		return "", false
	}
}

func shouldSkipDirectory(name string) bool {
	switch name {
	case ".git", ".idea", ".trae", ".vscode", "build", "dist", "node_modules", "target", "tmp", "vendor":
		return true
	default:
		return false
	}
}
