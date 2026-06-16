const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simulation State
let state = {
  isOomCrashed: false,
  isStressTest: false,
  isRdmaCongested: false,
  nodeStates: {
    'fastapi-gateway': 'ONLINE',
    'orchestrator': 'ONLINE',
    'redis': 'ONLINE',
    'model-node-1': 'ONLINE',
    'model-node-2': 'ONLINE',
    'rdma-simulator': 'ONLINE'
  }
};

// Log levels utility
const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  SYSTEM: 'SYSTEM'
};

// Keep list of SSE client response objects
let clients = [];

// Helper to send SSE event to all connected clients
function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => client.write(payload));
}

// Log message generator
function generateLog(container, level, message) {
  const timestamp = new Date().toISOString();
  return { container, level, timestamp, message };
}

// Route mapping for telemetry
function getActiveRoute() {
  if (state.isOomCrashed) {
    // If Model Node 2 is crashed, we have to route through Orchestrator to Node 1.
    // If RDMA is also congested, it's definitely TCP.
    return state.isRdmaCongested ? 'tcp-failover-single' : 'rdma-single';
  }
  return state.isRdmaCongested ? 'tcp-fallback' : 'rdma-bypass';
}

// Background simulation loop
setInterval(() => {
  // 1. Generate Telemetry Metrics
  let throughput = 0;
  let latency = 0;
  let drift = 0;
  let cpu = {};
  let memory = {};

  if (!state.isOomCrashed && !state.isStressTest && !state.isRdmaCongested) {
    // Normal State
    throughput = 45 + Math.random() * 10;
    latency = 18 + Math.random() * 5;
    drift = 0.02 + Math.random() * 0.03;
    cpu = { gateway: 8, orchestrator: 12, redis: 4, node1: 42, node2: 40, rdma: 5 };
    memory = { gateway: 22, orchestrator: 28, redis: 14, node1: 58, node2: 56, rdma: 8 };
  } else if (state.isStressTest && !state.isOomCrashed) {
    // Stress Test Normal Nodes
    throughput = 195 + Math.random() * 30;
    latency = 42 + Math.random() * 12;
    drift = 0.12 + Math.random() * 0.08;
    cpu = { gateway: 55, orchestrator: 68, redis: 28, node1: 88, node2: 86, rdma: 18 };
    memory = { gateway: 35, orchestrator: 42, redis: 25, node1: 78, node2: 76, rdma: 12 };
  } else if (state.isOomCrashed && !state.isStressTest) {
    // OOM Crash Normal load (Node 2 down)
    throughput = 22 + Math.random() * 5; // halved
    latency = 75 + Math.random() * 15; // bottlenecked
    drift = 0.35 + Math.random() * 0.15; // anomalous distribution
    cpu = { gateway: 12, orchestrator: 18, redis: 6, node1: 94, node2: 0, rdma: 3 };
    memory = { gateway: 24, orchestrator: 30, redis: 15, node1: 91, node2: 100, rdma: 5 }; // node2 memory pegged at 100% representing crash state/tombstone
  } else if (state.isOomCrashed && state.isStressTest) {
    // OOM Crash + Stress load (Critical bottle-neck)
    throughput = 35 + Math.random() * 8; 
    latency = 180 + Math.random() * 40; 
    drift = 0.65 + Math.random() * 0.15; 
    cpu = { gateway: 78, orchestrator: 85, redis: 38, node1: 99, node2: 0, rdma: 10 };
    memory = { gateway: 45, orchestrator: 52, redis: 32, node1: 96, node2: 100, rdma: 8 };
  }

  // Latency and CPU modification based on network congestion
  if (state.isRdmaCongested) {
    latency += 25 + Math.random() * 8; // TCP handshake penalty
    throughput *= 0.85; // network throttle
    cpu.rdma = 58 + Math.floor(Math.random() * 8); // PCIe/Host staging copy overhead spikes CPU load!
    cpu.orchestrator += 10; // extra framing overhead
  } else {
    // Keep it extremely low when bypassed via RDMA direct-path
    cpu.rdma = 2 + Math.floor(Math.random() * 2);
  }

  const telemetry = {
    timestamp: new Date().toISOString(),
    throughput: parseFloat(throughput.toFixed(2)),
    latency: parseFloat(latency.toFixed(2)),
    drift: parseFloat(drift.toFixed(3)),
    cpu,
    memory,
    activeRoute: getActiveRoute(),
    nodeStates: state.nodeStates
  };

  broadcast('telemetry', telemetry);

  // 2. Generate Simulated Log Lines
  const logs = [];
  const sec = new Date().getSeconds();

  // FastAPI Gateway logs
  if (sec % 3 === 0) {
    if (state.isStressTest) {
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.WARN, `Rate limit warning: Request burst detected. Incoming rate: ${Math.floor(throughput * 1.5)} req/sec`));
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.INFO, `Proxying request stream to orchestrator balancer. Queue depth: ${Math.floor(Math.random() * 20 + 10)}`));
    } else if (state.isOomCrashed) {
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.ERROR, `Gateway timeout from backend model-node-2. Retrying on model-node-1`));
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.WARN, `Response latency degraded. HTTP 504 / 502 warnings generated`));
    } else {
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.INFO, `POST /v1/chat/completions HTTP/1.1 200 OK - ${Math.floor(latency)}ms`));
      logs.push(generateLog('fastapi-gateway', LOG_LEVELS.INFO, `Access token validated. Client: ProductionAppServer`));
    }
  }

  // Orchestrator logs
  if (sec % 4 === 1) {
    if (state.isOomCrashed) {
      logs.push(generateLog('orchestrator', LOG_LEVELS.ERROR, `FAILOVER: model-node-2 did not respond to ping. Setting state to OFFLINE.`));
      logs.push(generateLog('orchestrator', LOG_LEVELS.WARN, `Rerouting 100% of workload to model-node-1. Latency budget exceeded.`));
    } else {
      logs.push(generateLog('orchestrator', LOG_LEVELS.INFO, `Load balancing: active nodes = [model-node-1, model-node-2]`));
      logs.push(generateLog('orchestrator', LOG_LEVELS.INFO, `Dispatched completion chunk task. Allocating weights: [0.50, 0.50]`));
    }
    if (state.isStressTest) {
      logs.push(generateLog('orchestrator', LOG_LEVELS.WARN, `Queue pressure high. Dispatch worker pool scaled to 64 active threads.`));
    }
  }

  // Redis Cache logs
  if (sec % 5 === 2) {
    const isHit = Math.random() > 0.7;
    if (state.isStressTest) {
      logs.push(generateLog('redis', LOG_LEVELS.INFO, `Command processed: MGET keys (32 items) - Eviction policy: volatile-lru`));
    } else {
      logs.push(generateLog('redis', LOG_LEVELS.INFO, isHit ? `CACHE_HIT: token_id_cache:prompt_hash_f84d9a` : `CACHE_MISS: prompt_hash_a34b22 - querying models`));
    }
  }

  // Model Node 1 logs
  if (sec % 3 === 1) {
    if (state.isOomCrashed) {
      logs.push(generateLog('model-node-1', LOG_LEVELS.WARN, `High-load profile active. VRAM: ${memory.node1}% occupied. Thermals: 74°C`));
      logs.push(generateLog('model-node-1', LOG_LEVELS.INFO, `Processing batch size 32. FlashAttention-2 enabled.`));
    } else if (state.isStressTest) {
      logs.push(generateLog('model-node-1', LOG_LEVELS.INFO, `Generating tokens... throughput = ${(throughput/2).toFixed(1)} t/s. Batch saturation: 92%`));
    } else {
      logs.push(generateLog('model-node-1', LOG_LEVELS.INFO, `CUDA kernel executed successfully. Token latency: 1.2ms/token`));
    }
  }

  // Model Node 2 logs
  if (sec % 3 === 2) {
    if (state.isOomCrashed) {
      // Node 2 is crashed - no normal logs, just crash dumps if they occur, or dead logs
      if (Math.random() > 0.8) {
        logs.push(generateLog('model-node-2', LOG_LEVELS.ERROR, `SYSTEM_TOMBSTONE: PID 451 exited with signal SIGKILL (OOM-killer)`));
      }
    } else {
      if (state.isStressTest) {
        logs.push(generateLog('model-node-2', LOG_LEVELS.INFO, `Generating tokens... throughput = ${(throughput/2).toFixed(1)} t/s. GPU Temp: 76°C`));
      } else {
        logs.push(generateLog('model-node-2', LOG_LEVELS.INFO, `Warm start weights verify: OK. Initialized FP16 inference pipeline.`));
      }
    }
  }

  // RDMA Simulator logs
  if (sec % 4 === 3) {
    if (state.isRdmaCongested) {
      logs.push(generateLog('rdma-simulator', LOG_LEVELS.ERROR, `RoCE v2 port congestion detected. Packet drop rate: 2.1%. Flow control active.`));
      logs.push(generateLog('rdma-simulator', LOG_LEVELS.WARN, `Bypassing RDMA direct-path. Fallback network route: TCP/IP via Eth1 interface.`));
    } else {
      logs.push(generateLog('rdma-simulator', LOG_LEVELS.INFO, `RDMA bypass established. Direct memory access GPU-to-GPU active.`));
      logs.push(generateLog('rdma-simulator', LOG_LEVELS.INFO, `RoCE latency: 0.85 microseconds. Zero-copy transfer active.`));
    }
  }

  // Send generated logs to clients
  logs.forEach(log => {
    broadcast('log', log);
  });

}, 1000);

// Timeout references for simulated self-healing
let recoveryTimeout1 = null;
let recoveryTimeout2 = null;

function clearRecoveryTimeouts() {
  if (recoveryTimeout1) clearTimeout(recoveryTimeout1);
  if (recoveryTimeout2) clearTimeout(recoveryTimeout2);
}

// API Endpoints
app.get('/api/state', (req, res) => {
  res.json(state);
});

app.post('/api/inject-oom', (req, res) => {
  clearRecoveryTimeouts();
  
  state.isOomCrashed = true;
  state.nodeStates['model-node-2'] = 'OFFLINE';
  
  // Immediately broadcast crash logs
  broadcast('log', generateLog('model-node-2', LOG_LEVELS.ERROR, `CRITICAL ERROR: CUDA out of memory. Tried to allocate 12.80 GiB (GPU 0; 16.00 GiB total capacity)`));
  broadcast('log', generateLog('model-node-2', LOG_LEVELS.ERROR, `FATAL: Kernel launch failed. Out of host/device memory.`));
  broadcast('log', generateLog('orchestrator', LOG_LEVELS.ERROR, `CRITICAL: model-node-2 heartbeat lost! Starting recovery sequence...`));
  
  broadcast('state-change', state);

  // AUTOMATED SELF-HEALING SIMULATION:
  // Step 1: Transition to RESTARTING after 3 seconds
  recoveryTimeout1 = setTimeout(() => {
    state.nodeStates['model-node-2'] = 'RESTARTING';
    broadcast('log', generateLog('orchestrator', LOG_LEVELS.SYSTEM, `RECOVERY: Self-healing activated for model-node-2. Simulating container replica launch...`));
    broadcast('state-change', state);
    
    // Step 2: Transition back to ONLINE after another 4 seconds (7s total)
    recoveryTimeout2 = setTimeout(() => {
      state.isOomCrashed = false;
      state.nodeStates['model-node-2'] = 'ONLINE';
      broadcast('log', generateLog('model-node-2', LOG_LEVELS.SYSTEM, `Container replica successfully launched for model-node-2. Re-joining pool with zero downtime.`));
      broadcast('log', generateLog('model-node-2', LOG_LEVELS.INFO, `Model loaded successfully. CUDA context initialized.`));
      broadcast('log', generateLog('orchestrator', LOG_LEVELS.SYSTEM, `Model Node 2 status restored: ONLINE. Re-integrating into balance group.`));
      broadcast('state-change', state);
    }, 4000);
  }, 3000);

  res.json({ success: true, message: 'OOM Crash injected. Automated self-healing sequence triggered.', state });
});

app.post('/api/recover-node', (req, res) => {
  clearRecoveryTimeouts();
  
  state.isOomCrashed = false;
  state.nodeStates['model-node-2'] = 'ONLINE';
  
  // Immediately broadcast recovery logs
  broadcast('log', generateLog('model-node-2', LOG_LEVELS.SYSTEM, `Manual restart triggered. Booting model weights...`));
  broadcast('log', generateLog('model-node-2', LOG_LEVELS.INFO, `Loading model weights from network storage (Llama-3-8B-FP16)...`));
  broadcast('log', generateLog('model-node-2', LOG_LEVELS.INFO, `Model loaded successfully. CUDA context initialized.`));
  broadcast('log', generateLog('orchestrator', LOG_LEVELS.SYSTEM, `Model Node 2 status restored: ONLINE. Re-integrating into balance group.`));
  
  broadcast('state-change', state);
  res.json({ success: true, message: 'Model Node 2 recovered manually', state });
});

app.post('/api/stress-test', (req, res) => {
  state.isStressTest = req.body.active !== undefined ? req.body.active : !state.isStressTest;
  
  if (state.isStressTest) {
    broadcast('log', generateLog('fastapi-gateway', LOG_LEVELS.SYSTEM, `Stress test triggered. Simulation load increased to 400 requests/sec.`));
    broadcast('log', generateLog('orchestrator', LOG_LEVELS.WARN, `Stress test active: throughput expected to spike. Allocating extra memory pools.`));
  } else {
    broadcast('log', generateLog('fastapi-gateway', LOG_LEVELS.SYSTEM, `Stress test terminated. Scaling back to normal traffic parameters.`));
  }

  broadcast('state-change', state);
  res.json({ success: true, message: `Stress test state: ${state.isStressTest}`, state });
});

app.post('/api/rdma-congestion', (req, res) => {
  state.isRdmaCongested = req.body.active !== undefined ? req.body.active : !state.isRdmaCongested;
  
  if (state.isRdmaCongested) {
    broadcast('log', generateLog('rdma-simulator', LOG_LEVELS.WARN, `Injecting network congestion into RDMA interface.`));
    broadcast('log', generateLog('orchestrator', LOG_LEVELS.WARN, `High latency detected on RoCE interfaces. Activating TCP socket fallback routing.`));
  } else {
    broadcast('log', generateLog('rdma-simulator', LOG_LEVELS.SYSTEM, `RDMA network congestion cleared. Disabling flow control, restoring bypass.`));
  }

  broadcast('state-change', state);
  res.json({ success: true, message: `RDMA congestion state: ${state.isRdmaCongested}`, state });
});

app.post('/api/reset', (req, res) => {
  clearRecoveryTimeouts();
  state.isOomCrashed = false;
  state.isStressTest = false;
  state.isRdmaCongested = false;
  state.nodeStates = {
    'fastapi-gateway': 'ONLINE',
    'orchestrator': 'ONLINE',
    'redis': 'ONLINE',
    'model-node-1': 'ONLINE',
    'model-node-2': 'ONLINE',
    'rdma-simulator': 'ONLINE'
  };

  broadcast('log', generateLog('orchestrator', LOG_LEVELS.SYSTEM, `System reset command received. Restoring base cluster configuration...`));
  broadcast('log', generateLog('rdma-simulator', LOG_LEVELS.SYSTEM, `Resetting network parameters. Restoring RoCE v2 direct-path.`));

  broadcast('state-change', state);
  res.json({ success: true, message: 'Simulation reset completed', state });
});

// Prompt Chaining Endpoint
app.post('/api/run-chain', (req, res) => {
  const { prompt, isToxic } = req.body;
  
  // We'll simulate a step-by-step chain with execution latencies
  let steps = [];
  let blocked = false;
  let finalResponse = "";

  // Step 1: Gateway Ingress
  steps.push({ name: 'Gateway Auth Check', duration: 3, status: 'success', info: 'Token validated, client authorized' });

  // Step 2: Guardrails Audit
  if (isToxic) {
    steps.push({ name: 'Guardrail Scan', duration: 15, status: 'failed', info: 'BLOCKED: Toxic content policy violation (Hate/Violence flagged)' });
    blocked = true;
    finalResponse = "Blocked: Your request contains text that violates our safety policies. [Code: GUARD-403]";
  } else {
    steps.push({ name: 'Guardrail Scan', duration: 12, status: 'success', info: 'Safety check passed (Toxic: 0.01, Hate: 0.00, Bias: 0.02)' });
    
    // Step 3: Cache lookup
    const cacheHit = Math.random() > 0.8 && !state.isStressTest;
    if (cacheHit) {
      steps.push({ name: 'Redis Cache Lookup', duration: 1, status: 'success', info: 'HIT: Found cached completion response' });
      finalResponse = "This is a cached response: " + prompt.substring(0, 30) + "... completed with high accuracy.";
    } else {
      steps.push({ name: 'Redis Cache Lookup', duration: 3, status: 'success', info: 'MISS: Query not found in cache' });
      
      // Step 4: Orchestrator node routing
      if (state.isOomCrashed) {
        steps.push({ name: 'Orchestrator Node Routing', duration: 8, status: 'success', info: 'Model Node 2 down. Routing exclusively to Model Node 1' });
        
        // Step 5: Model Inference
        const inferenceTime = state.isStressTest ? 150 : 80;
        steps.push({ name: 'Inference (Model Node 1)', duration: inferenceTime, status: 'success', info: `Execution time: ${inferenceTime}ms, Batch size: 32` });
      } else {
        const selectedNode = Math.random() > 0.5 ? 'Model Node 1' : 'Model Node 2';
        steps.push({ name: 'Orchestrator Node Routing', duration: 5, status: 'success', info: `Load-balanced. Selected: ${selectedNode}` });
        
        // Step 5: Model Inference
        const inferenceTime = state.isStressTest ? 60 : 35;
        steps.push({ name: 'Inference (' + selectedNode + ')', duration: inferenceTime, status: 'success', info: `Execution time: ${inferenceTime}ms, Batch size: 16` });
      }

      // Step 6: Outbound Response Guardrail
      steps.push({ name: 'Response Sanitization', duration: 8, status: 'success', info: 'PII, secrets, and leak prevention scans: PASSED' });
      
      finalResponse = `Successfully generated response for: "${prompt.length > 40 ? prompt.substring(0, 40) + '...' : prompt}". Output: The grid computed this prompt in parallel pipelines.`;
    }
  }

  res.json({ steps, blocked, finalResponse });
});

// SSE subscription endpoint
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // flush headers to establish SSE connection immediately

  // Send initial state
  res.write(`event: state-change\ndata: ${JSON.stringify(state)}\n\n`);

  clients.push(res);

  // Send a welcome system log
  const welcomeLog = generateLog('orchestrator', LOG_LEVELS.SYSTEM, 'Monitoring console connected to telemetry server.');
  res.write(`event: log\ndata: ${JSON.stringify(welcomeLog)}\n\n`);

  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
});

server.listen(PORT, () => {
  console.log(`Telemetry dashboard server running on http://localhost:${PORT}`);
});
