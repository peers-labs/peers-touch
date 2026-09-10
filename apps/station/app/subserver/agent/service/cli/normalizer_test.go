package cli

import (
	"reflect"
	"testing"
)

func TestNormalizeCommandExpandsKnownAdapters(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want NormalizedCommand
	}{
		{
			name: "trae alias",
			raw:  "traex",
			want: NormalizedCommand{
				Program:      "traecli",
				Args:         []string{"--json", "exec", "--skip-git-repo-check", "-"},
				AdapterName:  "trae",
				PromptMethod: PromptViaStdin,
			},
		},
		{
			name: "codex",
			raw:  "codex",
			want: NormalizedCommand{
				Program:      "codex",
				Args:         []string{"--json", "exec", "--skip-git-repo-check", "-"},
				AdapterName:  "codex",
				PromptMethod: PromptViaStdin,
			},
		},
		{
			name: "claude",
			raw:  "claude",
			want: NormalizedCommand{
				Program:      "claude",
				Args:         []string{"-p"},
				AdapterName:  "claude",
				PromptMethod: PromptViaStdin,
			},
		},
		{
			name: "cursor",
			raw:  "cursor",
			want: NormalizedCommand{
				Program:      "cursor-agent",
				Args:         []string{"--print", "--output-format", "text", "--trust"},
				AdapterName:  "cursor",
				PromptMethod: PromptViaArgument,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeCommand(test.raw)
			if err != nil {
				t.Fatalf("NormalizeCommand(%q) error = %v", test.raw, err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("NormalizeCommand(%q) = %#v, want %#v", test.raw, got, test.want)
			}
		})
	}
}

func TestNormalizeCommandPreservesExplicitArguments(t *testing.T) {
	got, err := NormalizeCommand(`/opt/tools/cursor-agent --model "fast model" --label 'review run'`)
	if err != nil {
		t.Fatalf("NormalizeCommand() error = %v", err)
	}

	want := NormalizedCommand{
		Program:      "/opt/tools/cursor-agent",
		Args:         []string{"--model", "fast model", "--label", "review run"},
		AdapterName:  "cursor",
		PromptMethod: PromptViaArgument,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("NormalizeCommand() = %#v, want %#v", got, want)
	}
}

func TestNormalizeCommandRejectsEmptyInput(t *testing.T) {
	if _, err := NormalizeCommand(" \t "); err == nil {
		t.Fatal("NormalizeCommand() must reject empty input")
	}
}

func TestSplitCommandLineKeepsQuotedArgumentsTogether(t *testing.T) {
	got := splitCommandLine(`tool --double "two words" --single 'three words'`)
	want := []string{"tool", "--double", "two words", "--single", "three words"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitCommandLine() = %#v, want %#v", got, want)
	}
}
