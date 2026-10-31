package main

import (
	"strings"
	"testing"
)

func TestTokenPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, token string
		invalid     bool
	}{
		{name: "empty refused", invalid: true},
		{name: "single character accepted", token: "1"},
		{name: "short accepted", token: "12345"},
		{name: "long accepted", token: strings.Repeat("x", 64)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateToken(tc.token); (err != nil) != tc.invalid {
				t.Fatalf("unexpected token validation: %v", err)
			}
		})
	}
}
