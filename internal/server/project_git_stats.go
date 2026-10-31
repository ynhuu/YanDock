package server

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	maxProjectStatFile  = 1 << 20
	maxProjectStatTotal = 16 << 20
)

func gitChangeStats(ctx context.Context, directory string, changes []projectChange) (int, int, bool) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	args := []string{"--no-pager", "diff", "--numstat", "-z", "--no-renames", "HEAD", "--"}
	data, err := runGit(ctx, directory, args, 4<<20)
	if err != nil {
		args = []string{"--no-pager", "diff", "--numstat", "-z", "--no-renames", "--cached", "--"}
		data, err = runGit(ctx, directory, args, 4<<20)
	}
	complete := err == nil && !bytes.Contains(data, []byte("\n…输出已截断…\n"))
	stats := make(map[string][2]int, len(changes))
	for _, record := range bytes.Split(data, []byte{0}) {
		fields := bytes.SplitN(record, []byte{'\t'}, 3)
		if len(fields) != 3 || bytes.Equal(fields[0], []byte("-")) || bytes.Equal(fields[1], []byte("-")) {
			continue
		}
		additions, addErr := strconv.Atoi(string(fields[0]))
		deletions, deleteErr := strconv.Atoi(string(fields[1]))
		if addErr != nil || deleteErr != nil {
			continue
		}
		stats[filepath.ToSlash(string(fields[2]))] = [2]int{additions, deletions}
	}
	var root *os.Root
	budget := int64(maxProjectStatTotal)
	for index := range changes {
		changes[index].StatsComplete = complete
		if changes[index].Status == "??" {
			if root == nil {
				root, _ = os.OpenRoot(directory)
			}
			changes[index].StatsComplete = false
			if root != nil {
				changes[index].Additions, changes[index].StatsComplete = countProjectTextLines(ctx, root, changes[index].Path, &budget)
			}
			continue
		}
		if changeStats, ok := stats[changes[index].Path]; ok {
			changes[index].Additions = changeStats[0]
			changes[index].Deletions = changeStats[1]
		}
	}
	if root != nil {
		_ = root.Close()
	}
	additions, deletions := 0, 0
	for _, change := range changes {
		additions += change.Additions
		deletions += change.Deletions
		complete = complete && change.StatsComplete
	}
	return additions, deletions, complete
}

// A shared request budget bounds aggregate disk reads; skipped files never
// report a partial line count as an exact value.
func countProjectTextLines(ctx context.Context, root *os.Root, name string, budget *int64) (int, bool) {
	if ctx.Err() != nil {
		return 0, false
	}
	relative, err := cleanProjectPath(name)
	if err != nil || relative == "." || hasGitComponent(relative) {
		return 0, false
	}
	info, err := projectInfo(root, relative, false)
	if err != nil || !info.Mode().IsRegular() {
		return 0, false
	}
	if info.Size() > maxProjectStatFile || info.Size() > *budget {
		return 0, false
	}
	file, err := root.Open(relative)
	if err != nil {
		return 0, false
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxProjectStatFile || info.Size() > *budget {
		return 0, false
	}
	limit := min(int64(maxProjectStatFile), *budget)
	reader := io.LimitReader(file, limit+1)
	buffer := make([]byte, 32<<10)
	lines, hasContent := 0, false
	var read int64
	var lastByte byte
	for {
		if ctx.Err() != nil {
			return 0, false
		}
		count, readErr := reader.Read(buffer)
		read += int64(count)
		*budget -= int64(count)
		if read > limit {
			return 0, false
		}
		chunk := buffer[:count]
		if bytes.IndexByte(chunk, 0) >= 0 {
			return 0, true
		}
		lines += bytes.Count(chunk, []byte{'\n'})
		if count > 0 {
			hasContent = true
			lastByte = chunk[count-1]
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return 0, false
		}
	}
	if hasContent && lastByte != '\n' {
		lines++
	}
	return lines, true
}
