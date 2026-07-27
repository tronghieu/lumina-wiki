package retrieval

import "strings"

func markdownHeading(line string) (int, string) {
	line, ok := trimMarkdownIndent(line)
	if !ok {
		return 0, ""
	}
	count := 0
	for count < len(line) && count < 6 && line[count] == '#' {
		count++
	}
	if count == 0 || len(line) <= count || (line[count] != ' ' && line[count] != '\t') {
		return 0, ""
	}
	return count, normalizeATXLabel(line[count+1:])
}

func normalizeATXLabel(label string) string {
	label = strings.Trim(label, " \t")
	end := len(label)
	for end > 0 && label[end-1] == '#' {
		end--
	}
	if end < len(label) && end > 0 && (label[end-1] == ' ' || label[end-1] == '\t') {
		label = strings.TrimRight(label[:end-1], " \t")
	}
	return label
}

func setextHeadingLevel(line string) int {
	line, ok := trimMarkdownIndent(line)
	if !ok {
		return 0
	}
	line = strings.TrimRight(line, " \t")
	if line == "" {
		return 0
	}
	marker := line[0]
	if marker != '=' && marker != '-' {
		return 0
	}
	for index := 1; index < len(line); index++ {
		if line[index] != marker {
			return 0
		}
	}
	if marker == '=' {
		return 1
	}
	return 2
}

func normalizeSetextLabel(lines []string) string {
	labels := make([]string, len(lines))
	for index, line := range lines {
		labels[index] = strings.Trim(line, " \t")
	}
	return strings.Join(labels, " ")
}

func trimMarkdownIndent(line string) (string, bool) {
	indent := 0
	for indent < len(line) && line[indent] == ' ' {
		indent++
	}
	if indent > 3 {
		return "", false
	}
	return line[indent:], true
}

func isIndentedCode(line string) bool {
	return strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t")
}
