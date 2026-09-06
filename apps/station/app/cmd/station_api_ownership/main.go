package main

import (
	"encoding/json"
	"flag"
	"io"
	"os"
)

func main() {
	os.Exit(runCLI(os.Args[1:], os.Stdout))
}

func runCLI(arguments []string, output io.Writer) int {
	flags := flag.NewFlagSet(gateID, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	root := flags.String("root", ".", "repository root")
	registryPath := flags.String(
		"registry",
		"docs/architecture/api-ownership/station-api-capabilities.yaml",
		"repository-relative ownership registry path",
	)
	if err := flags.Parse(arguments); err != nil {
		report := analysisReport{
			SchemaVersion: schemaVersion,
			Gate:          gateID,
			Status:        "FAIL",
			Routes:        []discoveredRoute{},
			Diagnostics: []diagnostic{{
				Code:    "gate_configuration_error",
				Message: err.Error(),
			}},
		}
		finalizeReport(&report)
		writeReport(output, report)
		return 2
	}

	report := analyze(analysisOptions{
		Root:         *root,
		RegistryPath: *registryPath,
	})
	if err := writeReport(output, report); err != nil {
		return 2
	}
	if report.Status != "PASS" {
		return 1
	}
	return 0
}

func writeReport(output io.Writer, report analysisReport) error {
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
