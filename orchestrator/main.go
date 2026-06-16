package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// NodeState represents the operational status of a model backend node.
type NodeState string

const (
	StateHealthy     NodeState = "HEALTHY"
	StateUnhealthy   NodeState = "UNHEALTHY"
	StateOOMIsolated NodeState = "OOM_ISOLATED"
	StateRestarting  NodeState = "RESTARTING"
)

// ModelNode represents a single backend container running a model (e.g., vLLM or Ollama).
type ModelNode struct {
	ID               string       `json:"id"`
	URL              *url.URL     `json:"url"`
	State            NodeState    `json:"state"`
	ConsecutiveFails int32        `json:"consecutive_fails"`
	LastSeen         time.Time    `json:"last_seen"`
	Mutex            sync.RWMutex `json:"-"`
}

// Orchestrator coordinates the pool of model nodes, health checks, and load balancing.
type Orchestrator struct {
	nodes        []*ModelNode
	nodesMutex   sync.RWMutex
	roundRobin   uint64
	client       *http.Client
	spinupDelay  time.Duration // Time to simulate launching a container replica
}

func NewOrchestrator(nodeURLs []string) *Orchestrator {
	orchestrator := &Orchestrator{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		spinupDelay: 5 * time.Second,
	}

	for i, rawURL := range nodeURLs {
		parsedURL, err := url.Parse(rawURL)
		if err != nil {
			log.Fatalf("Invalid node URL %s: %v", rawURL, err)
		}
		node := &ModelNode{
			ID:       fmt.Sprintf("model-node-%d", i+1),
			URL:      parsedURL,
			State:    StateHealthy,
			LastSeen: time.Now(),
		}
		orchestrator.nodes = append(orchestrator.nodes, node)
		log.Printf("Registered model backend: %s (%s)", node.ID, node.URL.String())
	}

	return orchestrator
}

// StartHealthChecks begins the background loop for health status verification.
func (o *Orchestrator) StartHealthChecks(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				o.checkAllNodes()
			}
		}
	}()
}

func (o *Orchestrator) checkAllNodes() {
	o.nodesMutex.RLock()
	nodes := make([]*ModelNode, len(o.nodes))
	copy(nodes, o.nodes)
	o.nodesMutex.RUnlock()

	var wg sync.WaitGroup
	for _, n := range nodes {
		wg.Add(1)
		go func(node *ModelNode) {
			defer wg.Done()
			o.checkNodeHealth(node)
		}(n)
	}
	wg.Wait()
}

func (o *Orchestrator) checkNodeHealth(node *ModelNode) {
	node.Mutex.Lock()
	defer node.Mutex.Unlock()

	// If the node is currently in RESTARTING mode, skip health polling until spinup completes.
	if node.State == StateRestarting {
		return
	}

	healthURL := fmt.Sprintf("%s/health", node.URL.String())
	req, err := http.NewRequestWithContext(context.Background(), "GET", healthURL, nil)
	if err != nil {
		node.ConsecutiveFails++
		o.evaluateNodeFailure(node, fmt.Sprintf("failed request creation: %v", err))
		return
	}

	resp, err := o.client.Do(req)
	if err != nil {
		node.ConsecutiveFails++
		o.evaluateNodeFailure(node, fmt.Sprintf("network error: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		node.ConsecutiveFails++
		o.evaluateNodeFailure(node, fmt.Sprintf("non-200 status: %d", resp.StatusCode))
		return
	}

	// Read body to check if there are any OOM flags in the health payload
	bodyBytes, err := io.ReadAll(resp.Body)
	if err == nil && (strings.Contains(strings.ToLower(string(bodyBytes)), "oom") || strings.Contains(strings.ToLower(string(bodyBytes)), "out of memory")) {
		o.isolateNodeForOOM(node, "OOM reported in health response body")
		return
	}

	// Node is healthy
	node.ConsecutiveFails = 0
	node.LastSeen = time.Now()
	if node.State != StateHealthy {
		log.Printf("[HEAL] Node %s recovered and is now HEALTHY", node.ID)
		node.State = StateHealthy
	}
}

// evaluateNodeFailure determines if a node should be marked unhealthy based on failures.
func (o *Orchestrator) evaluateNodeFailure(node *ModelNode, reason string) {
	if node.State == StateHealthy && node.ConsecutiveFails >= 3 {
		log.Printf("[FAULT] Node %s isolated due to persistent health failures: %s", node.ID, reason)
		node.State = StateUnhealthy
		o.triggerContainerSelfHealing(node)
	} else {
		log.Printf("[WARN] Node %s health check failed (attempt %d/3): %s", node.ID, node.ConsecutiveFails, reason)
	}
}

// isolateNodeForOOM handles immediate node isolation when an Out-Of-Memory fault is caught.
func (o *Orchestrator) isolateNodeForOOM(node *ModelNode, reason string) {
	if node.State != StateOOMIsolated && node.State != StateRestarting {
		log.Printf("[CRITICAL] Node %s triggered CUDA OOM! Isolating immediately: %s", node.ID, reason)
		node.State = StateOOMIsolated
		o.triggerContainerSelfHealing(node)
	}
}

// triggerContainerSelfHealing simulates rebuilding or restarting the node's Docker container.
func (o *Orchestrator) triggerContainerSelfHealing(node *ModelNode) {
	node.State = StateRestarting
	log.Printf("[RECOVERY] Self-healing activated for %s. Simulating container replica launch...", node.ID)

	go func() {
		// Simulate latency for container creation, port binding, and model loading.
		time.Sleep(o.spinupDelay)

		node.Mutex.Lock()
		defer node.Mutex.Unlock()

		node.ConsecutiveFails = 0
		node.LastSeen = time.Now()
		node.State = StateHealthy
		log.Printf("[RECOVERY] Container replica successfully launched for %s. Re-joining pool with zero downtime.", node.ID)
	}()
}

// GetNextHealthyNode uses Round-Robin selection to find an active healthy node.
func (o *Orchestrator) GetNextHealthyNode() (*ModelNode, error) {
	o.nodesMutex.RLock()
	defer o.nodesMutex.RUnlock()

	numNodes := uint64(len(o.nodes))
	if numNodes == 0 {
		return nil, fmt.Errorf("no nodes registered in orchestrator pool")
	}

	// Iterate through nodes to find the next healthy one
	for i := uint64(0); i < numNodes; i++ {
		idx := atomic.AddUint64(&o.roundRobin, 1) % numNodes
		node := o.nodes[idx]

		node.Mutex.RLock()
		isHealthy := (node.State == StateHealthy)
		node.Mutex.RUnlock()

		if isHealthy {
			return node, nil
		}
	}

	return nil, fmt.Errorf("all backend nodes are currently isolated or restarting")
}

// ServeHTTP acts as a reverse proxy, routing client requests with fault-tolerance and failover.
func (o *Orchestrator) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Expose special status endpoint for orchestrator dashboard / system checks
	if r.URL.Path == "/orchestrator/status" {
		o.handleStatus(w, r)
		return
	}

	// Main request proxy loop with zero-downtime retry rules
	var lastErr error
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		node, err := o.GetNextHealthyNode()
		if err != nil {
			log.Printf("[PROXY] Request routing failed: %v", err)
			http.Error(w, "Service Unavailable: Model backend nodes isolated or restarting", http.StatusServiceUnavailable)
			return
		}

		log.Printf("[PROXY] Routing request to %s (Attempt %d/%d)", node.ID, attempt, maxRetries)

		// Set up the reverse proxy for this backend node
		proxy := httputil.NewSingleHostReverseProxy(node.URL)

		// Intercept errors and responses to detect timeout and OOM issues
		proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, err error) {
			node.Mutex.Lock()
			node.ConsecutiveFails++
			lastErr = err
			if strings.Contains(strings.ToLower(err.Error()), "timeout") || os.IsTimeout(err) {
				log.Printf("[FAULT] Node %s request timed out: %v", node.ID, err)
				o.isolateNodeForOOM(node, fmt.Sprintf("Timeout fault: %v", err))
			} else {
				log.Printf("[FAULT] Node %s connection error: %v", node.ID, err)
				o.evaluateNodeFailure(node, fmt.Sprintf("proxy connection error: %v", err))
			}
			node.Mutex.Unlock()
		}

		// Buffer request body so we can retry on another node if this one fails
		var bodyBytes []byte
		if r.Body != nil {
			bodyBytes, _ = io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		}

		// Wrap response writer to capture status code and body
		recorder := &responseCapture{ResponseWriter: w, body: &bytes.Buffer{}}

		// Perform proxy request
		proxy.ServeHTTP(recorder, r)

		// If a proxy connection/timeout error was logged, retry on a different node
		if lastErr != nil {
			lastErr = nil // Clear error flag for next iteration
			// Reset request body for retry
			if r.Body != nil {
				r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}
			continue
		}

		// Check response content for hidden out-of-memory or timeout faults
		responseBody := recorder.body.String()
		lowerBody := strings.ToLower(responseBody)
		if recorder.statusCode == http.StatusInternalServerError &&
			(strings.Contains(lowerBody, "oom") || strings.Contains(lowerBody, "out of memory") || strings.Contains(lowerBody, "cuda")) {
			node.Mutex.Lock()
			o.isolateNodeForOOM(node, "OOM substring found in HTTP 500 response body")
			node.Mutex.Unlock()

			// Retry on a different node
			log.Printf("[PROXY] OOM detected on %s. Re-routing request...", node.ID)
			if r.Body != nil {
				r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}
			continue
		}

		// If we reach here, request succeeded, or returned a legitimate status code (e.g. 400, 401)
		// Write the captured response headers and body to the real response writer
		for k, v := range recorder.Header() {
			w.Header()[k] = v
		}
		w.WriteHeader(recorder.statusCode)
		w.Write(recorder.body.Bytes())
		return
	}

	// If we exhausted all retries
	http.Error(w, "Gateway Timeout: Backend processing failed after multiple retries", http.StatusGatewayTimeout)
}

// responseCapture is a custom writer to capture proxy responses for evaluation before sending them to the client.
type responseCapture struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
}

func (rc *responseCapture) WriteHeader(statusCode int) {
	rc.statusCode = statusCode
}

func (rc *responseCapture) Write(b []byte) (int, error) {
	if rc.statusCode == 0 {
		rc.statusCode = http.StatusOK
	}
	return rc.body.Write(b)
}

func (o *Orchestrator) handleStatus(w http.ResponseWriter, r *http.Request) {
	o.nodesMutex.RLock()
	defer o.nodesMutex.RUnlock()

	type NodeStatus struct {
		ID               string    `json:"id"`
		URL              string    `json:"url"`
		State            NodeState `json:"state"`
		ConsecutiveFails int32     `json:"consecutive_fails"`
		LastSeen         time.Time `json:"last_seen"`
	}

	var statuses []NodeStatus
	for _, n := range o.nodes {
		n.Mutex.RLock()
		statuses = append(statuses, NodeStatus{
			ID:               n.ID,
			URL:              n.URL.String(),
			State:            n.State,
			ConsecutiveFails: n.ConsecutiveFails,
			LastSeen:         n.LastSeen,
		})
		n.Mutex.RUnlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statuses)
}

func main() {
	log.Println("Initializing FlynthAI-Grid Orchestrator...")


	// Read backend endpoints from environment variables or use defaults
	backendList := os.Getenv("MODEL_BACKEND_NODES")
	var urls []string
	if backendList != "" {
		urls = strings.Split(backendList, ",")
	} else {
		// Default nodes matching standard docker-compose service names
		urls = []string{
			"http://model-node-1:5000",
			"http://model-node-2:5000",
		}
	}

	orchestrator := NewOrchestrator(urls)

	// Start polling loop every 3 seconds
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	orchestrator.StartHealthChecks(ctx, 3*time.Second)

	// Listen on port 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:    ":" + port,
		Handler: orchestrator,
	}

	log.Printf("Orchestrator running, proxying requests on port %s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server startup failed: %v", err)
	}
}
