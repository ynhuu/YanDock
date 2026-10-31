package server

import "testing"

func TestParseControl(t *testing.T) {
	for _, tc := range []struct {
		name, data string
		invalid    bool
	}{
		{name: "resize", data: `{"type":"resize","cols":80,"rows":24}`},
		{name: "whitespace", data: " {\"type\":\"resize\",\"cols\":80,\"rows\":24}\n"},
		{name: "unknown type", data: `{"type":"input","cols":80,"rows":24}`, invalid: true},
		{name: "unknown field", data: `{"type":"resize","cols":80,"rows":24,"extra":1}`, invalid: true},
		{name: "version", data: `{"type":"resize","cols":80,"rows":24,"version":1}`, invalid: true},
		{name: "multiple values", data: `{"type":"resize","cols":80,"rows":24} {}`, invalid: true},
		{name: "invalid JSON", data: `{`, invalid: true},
		{name: "negative dimension", data: `{"type":"resize","cols":-1,"rows":24}`, invalid: true},
		{name: "overflow", data: `{"type":"resize","cols":65536,"rows":24}`, invalid: true},
		{name: "null", data: `null`, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := parseControl([]byte(tc.data))
			if (err != nil) != tc.invalid {
				t.Fatalf("parse error = %v, invalid = %v", err, tc.invalid)
			}
			if !tc.invalid && (c.Type != "resize" || c.Cols != 80 || c.Rows != 24) {
				t.Fatalf("unexpected control: %+v", c)
			}
		})
	}
}
