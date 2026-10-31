package webassets

import (
	"embed"
	"io/fs"
)

// Build the frontend first: pnpm --dir web build.
//
//go:embed dist
var content embed.FS

func FS() fs.FS {
	f, err := fs.Sub(content, "dist")
	if err != nil {
		panic(err)
	}
	return f
}
