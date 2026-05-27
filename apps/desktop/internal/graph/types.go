package graph

type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

type Node struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Type    string `json:"type"`
	Path    string `json:"path"`
	Preview string `json:"preview"`
}

type Edge struct {
	From string `json:"from"`
	Type string `json:"type"`
	To   string `json:"to"`
}
