package session

import (
	"slices"
	"testing"
)

func TestTerminalEnvironmentDoesNotModifySource(t *testing.T) {
	env := []string{"TERM=dumb", "LC_ALL=C", "LC_CTYPE=C", "LANG="}
	original := slices.Clone(env)
	got := terminalEnvironment(env, "darwin")
	if !slices.Equal(env, original) {
		t.Fatalf("source environment changed: %q", env)
	}
	got[0] = "CHANGED=value"
	if !slices.Equal(env, original) {
		t.Fatal("child environment aliases the source")
	}
}

func TestTerminalEnvironmentUsesUTF8CharacterLocale(t *testing.T) {
	tests := []struct {
		name string
		goos string
		want string
		env  []string
	}{
		{
			name: "macOS C locale",
			goos: "darwin",
			want: "UTF-8",
			env:  []string{"PATH=/bin", "LANG=", "LC_CTYPE=C", "LC_ALL=", "LC_COLLATE=C", "TERM=dumb"},
		},
		{
			name: "Linux global C locale",
			goos: "linux",
			want: "C.UTF-8",
			env:  []string{"PATH=/bin", "LANG=C", "LC_CTYPE=C", "LC_ALL=C", "LC_COLLATE=C"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := terminalEnvironment(tt.env, tt.goos)
			values := environmentMap(got)
			if values["LC_CTYPE"] != tt.want {
				t.Fatalf("LC_CTYPE = %q, want %q", values["LC_CTYPE"], tt.want)
			}
			if _, ok := values["LC_ALL"]; ok {
				t.Fatalf("non-UTF-8 LC_ALL was not removed: %q", values["LC_ALL"])
			}
			if values["LC_COLLATE"] != "C" {
				t.Fatalf("LC_COLLATE = %q, want C", values["LC_COLLATE"])
			}
			if values["TERM"] != "xterm-256color" {
				t.Fatalf("TERM = %q, want xterm-256color", values["TERM"])
			}
		})
	}
}

func TestTerminalEnvironmentPreservesUTF8Locale(t *testing.T) {
	env := []string{
		"PATH=/bin",
		"LANG=zh_CN.UTF-8",
		"LC_CTYPE=C",
		"LC_ALL=zh_CN.UTF-8",
		"TERM=dumb",
	}
	got := terminalEnvironment(env, "linux")
	values := environmentMap(got)
	if values["LC_ALL"] != "zh_CN.UTF-8" {
		t.Fatalf("LC_ALL = %q, want inherited UTF-8 locale", values["LC_ALL"])
	}
	if values["LC_CTYPE"] != "C" {
		t.Fatalf("LC_CTYPE = %q, want inherited value C", values["LC_CTYPE"])
	}
	if values["TERM"] != "xterm-256color" {
		t.Fatalf("TERM = %q, want xterm-256color", values["TERM"])
	}
}

func environmentMap(env []string) map[string]string {
	values := make(map[string]string, len(env))
	for _, entry := range env {
		for index, char := range entry {
			if char == '=' {
				values[entry[:index]] = entry[index+1:]
				break
			}
		}
	}
	return values
}
