package graph

import (
	"strings"
)

func parseMarkdownNote(path string, raw []byte) Node {
	content := string(raw)
	meta, body := splitFrontmatter(content)
	title := meta["title"]
	id := meta["id"]
	if id == "" {
		id = strings.TrimSuffix(path, ".md")
	}
	if title == "" {
		title = id
	}
	return Node{
		ID:      id,
		Title:   title,
		Type:    meta["type"],
		Path:    path,
		Preview: preview(body),
	}
}

func splitFrontmatter(content string) (map[string]string, string) {
	meta := map[string]string{}
	if !strings.HasPrefix(content, "---\n") {
		return meta, content
	}
	rest := strings.TrimPrefix(content, "---\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return meta, content
	}
	for _, line := range strings.Split(rest[:end], "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(line, " ") {
			continue
		}
		meta[strings.TrimSpace(key)] = trimScalar(value)
	}
	return meta, strings.TrimSpace(rest[end+4:])
}

func trimScalar(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, `"'`)
	return value
}

func preview(body string) string {
	fields := strings.Fields(body)
	if len(fields) > 32 {
		fields = fields[:32]
	}
	return strings.Join(fields, " ")
}
