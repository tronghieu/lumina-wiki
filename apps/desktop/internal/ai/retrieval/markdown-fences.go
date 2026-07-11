package retrieval

import "strings"

func fenceOpen(line string) (rune, int, bool) {
	line = trimFenceIndent(line)
	if line == "" {
		return 0, 0, false
	}
	marker := rune(line[0])
	if marker != '`' && marker != '~' {
		return 0, 0, false
	}
	length := 0
	for _, current := range line {
		if current != marker {
			break
		}
		length++
	}
	return marker, length, length >= 3
}

func isFenceClose(line string, marker rune, minimum int) bool {
	line = trimFenceIndent(line)
	length := 0
	for _, current := range line {
		if current != marker {
			break
		}
		length++
	}
	return length >= minimum && strings.TrimSpace(line[length:]) == ""
}

func trimFenceIndent(line string) string {
	for count := 0; count < 3 && strings.HasPrefix(line, " "); count++ {
		line = line[1:]
	}
	return line
}
