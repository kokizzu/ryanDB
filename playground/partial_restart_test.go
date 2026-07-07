package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/ryanssenn/quorum/internal/harness"
)

func TestPartialRestartElectsLeaderWithMajority(t *testing.T) {
	repoRoot := findRepoRoot()
	binaryPath := filepath.Join(repoRoot, "quorum")
	build := exec.Command("go", "build", "-o", binaryPath, ".")
	build.Dir = repoRoot
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}

	harness.KillPorts(7)
	t.Cleanup(func() { harness.KillPorts(7) })

	srv := NewServer(binaryPath, repoRoot, false)
	srv.cluster = NewCluster(7)
	mux := http.NewServeMux()
	srv.registerRoutes(mux, http.NotFoundHandler())
	ts := httptest.NewServer(mux)
	defer ts.Close()

	post := func(path string, body any) (*http.Response, []byte) {
		var buf bytes.Buffer
		if body != nil {
			json.NewEncoder(&buf).Encode(body)
		}
		resp, err := http.Post(ts.URL+path, "application/json", &buf)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp, b
	}

	post("/api/cluster/create", map[string]int{"nodes": 7})
	resp, body := post("/api/cluster/start", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("start: %d %s", resp.StatusCode, body)
	}
	waitLeader(t, ts.URL, 20*time.Second)

	for i := 1; i <= 7; i++ {
		post("/api/cluster/node/stop", map[string]string{"id": fmt.Sprintf("node%d", i)})
	}

	// quorum for 7 configured nodes is 4
	for i := 1; i <= 4; i++ {
		resp, body = post("/api/cluster/node/start", map[string]string{"id": fmt.Sprintf("node%d", i)})
		if resp.StatusCode != 200 {
			t.Fatalf("restart node%d: %d %s", i, resp.StatusCode, body)
		}
	}

	time.Sleep(8 * time.Second)
	st := getStatus(t, ts.URL)
	if countLeaders(st.Nodes) != 1 {
		t.Fatalf("expected leader after 4-node restart, got: %+v", st.Nodes)
	}
}
