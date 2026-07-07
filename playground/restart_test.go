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

func TestRestartAllNodesElectsLeader(t *testing.T) {
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
		t.Fatalf("cluster start: %d %s", resp.StatusCode, body)
	}
	waitLeader(t, ts.URL, 20*time.Second)

	for i := 1; i <= 7; i++ {
		id := fmt.Sprintf("node%d", i)
		resp, body = post("/api/cluster/node/stop", map[string]string{"id": id})
		if resp.StatusCode != 200 {
			t.Fatalf("stop %s: %d %s", id, resp.StatusCode, body)
		}
	}

	st := getStatus(t, ts.URL)
	if !st.ClusterStarted {
		t.Fatal("expected clusterStarted true after individual stops")
	}
	if countLeaders(st.Nodes) != 0 {
		t.Fatalf("expected no leaders, got %d", countLeaders(st.Nodes))
	}

	for i := 1; i <= 7; i++ {
		id := fmt.Sprintf("node%d", i)
		resp, body = post("/api/cluster/node/start", map[string]string{"id": id})
		if resp.StatusCode != 200 {
			t.Fatalf("restart %s: %d %s", id, resp.StatusCode, body)
		}
	}

	waitLeader(t, ts.URL, 30*time.Second)
}

func TestClusterStopThenStartElectsLeader(t *testing.T) {
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
		t.Fatalf("cluster start: %d %s", resp.StatusCode, body)
	}
	waitLeader(t, ts.URL, 20*time.Second)

	resp, body = post("/api/cluster/stop", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("cluster stop: %d %s", resp.StatusCode, body)
	}

	st := getStatus(t, ts.URL)
	if st.ClusterStarted {
		t.Fatal("expected clusterStarted false after cluster stop")
	}

	resp, body = post("/api/cluster/start", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("cluster restart: %d %s", resp.StatusCode, body)
	}

	waitLeader(t, ts.URL, 20*time.Second)
}

type statusResp struct {
	ClusterStarted bool         `json:"clusterStarted"`
	Nodes          []NodeStatus `json:"nodes"`
}

func getStatus(t *testing.T, base string) statusResp {
	t.Helper()
	resp, err := http.Get(base + "/api/cluster/status")
	if err != nil {
		t.Fatal(err)
	}
	var s statusResp
	json.NewDecoder(resp.Body).Decode(&s)
	resp.Body.Close()
	return s
}

func countLeaders(nodes []NodeStatus) int {
	n := 0
	for _, node := range nodes {
		if node.Running && node.State == 2 {
			n++
		}
	}
	return n
}

func waitLeader(t *testing.T, base string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		st := getStatus(t, base)
		if countLeaders(st.Nodes) == 1 {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	st := getStatus(t, base)
	t.Fatalf("no leader after %v: %+v", timeout, st.Nodes)
}
