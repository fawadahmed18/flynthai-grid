/**
 * Flynth AI Grid Orchestrator Dashboard Controller
 * Code architecture: Modularized classes for high performance and encapsulation
 */

// 1. GLOBAL STATE DEFINITION
const AppState = {
  activeView: 'dashboard',
  currentLogTab: 'fastapi-gateway',
  isOomCrashed: false,
  isStressTest: false,
  isRdmaCongested: false,
  activeRoute: 'rdma-bypass',
  
  nodeStates: {
    'fastapi-gateway': 'ONLINE',
    'orchestrator': 'ONLINE',
    'redis': 'ONLINE',
    'model-node-1': 'ONLINE',
    'model-node-2': 'ONLINE',
    'rdma-simulator': 'ONLINE'
  },
  
  // Static architectural node details for hover inspection
  nodeRegistry: {
    'Client': { desc: 'External Request Ingress node', ip: '192.168.1.10', cpu: '2%', mem: '14MB', address: '0x0000000000' },
    'Gateway': { desc: 'FlynthAI FastAPI Gateway (Port 80)', ip: '10.0.1.5', cpu: '8%', mem: '22MB', address: '0x7fffb8e210' },
    'Router': { desc: 'Go Load Balancer & Supervisor', ip: '10.0.1.6', cpu: '12%', mem: '28MB', address: '0x7fffca9100' },
    'Redis Cache': { desc: 'Redis Semantic Caching Tier', ip: '10.0.1.7', cpu: '4%', mem: '14MB', address: '0x7fffda3400' },
    'Host OS': { desc: 'Host CPU Memory Staging Buffer', ip: '10.0.1.1', cpu: '2%', mem: '32MB', address: '0x7fffe94100' },
    'Model Node 1': { desc: 'NVIDIA H100 GPU - Llama-3-8B', ip: '10.0.2.11', cpu: '42%', mem: '8.2GB', address: '0x00ff8a9100' },
    'Model Node 2': { desc: 'NVIDIA H100 GPU - Mistral-7B', ip: '10.0.2.12', cpu: '40%', mem: '8.0GB', address: '0x00ff9b3400' }
  },

  logBuffers: {
    'fastapi-gateway': [],
    'orchestrator': [],
    'redis': [],
    'model-node-1': [],
    'model-node-2': [],
    'rdma-simulator': []
  },
  lastPrompt: ''
};

// 2. CANVAS MAPPING AND RENDERING ENGINE
class CanvasGridManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.dashOffset = 0;
    this.hoveredNode = null;
    
    // Scale Canvas for Retina displays
    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    // Spaced out coordinates to fit capsule layouts
    this.nodes = {
      'Client': { x: 80, y: 210 },
      'Gateway': { x: 220, y: 210 },
      'Router': { x: 370, y: 110 },
      'Redis Cache': { x: 370, y: 310 },
      'Host OS': { x: 480, y: 210 }, // Centered staging node
      'Model Node 1': { x: 580, y: 110 },
      'Model Node 2': { x: 580, y: 310 }
    };
    
    this.setupHoverListener();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  setupHoverListener() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      let foundNode = null;
      for (const [name, coord] of Object.entries(this.nodes)) {
        // Precise bounding box hover check for 120x36 capsules
        if (Math.abs(mouseX - coord.x) < 60 && Math.abs(mouseY - coord.y) < 18) {
          foundNode = name;
          break;
        }
      }
      
      this.hoveredNode = foundNode;
      this.canvas.style.cursor = foundNode ? 'pointer' : 'default';
      this.updateHoverPanel(foundNode);
    });
  }

  updateHoverPanel(nodeName) {
    const panel = document.getElementById('node-hover-panel');
    const nameEl = document.getElementById('hover-node-name');
    const cpuEl = document.getElementById('hover-stat-cpu');
    const memEl = document.getElementById('hover-stat-mem');
    const stateEl = document.getElementById('hover-stat-state');
    
    if (!nodeName) {
      nameEl.textContent = '-';
      cpuEl.textContent = '-';
      memEl.textContent = '-';
      stateEl.textContent = '-';
      return;
    }
    
    const nodeInfo = AppState.nodeRegistry[nodeName];
    const key = nodeName === 'Model Node 2' ? 'node2' : 
                nodeName === 'Model Node 1' ? 'node1' : 
                nodeName === 'Redis Cache' ? 'redis' : 
                nodeName === 'Router' ? 'orchestrator' : 
                nodeName === 'Gateway' ? 'gateway' : 
                nodeName === 'Host OS' ? 'rdma' : 'client';
                
    const nodeStatus = (key === 'client' || key === 'rdma') ? 'ONLINE' : AppState.nodeStates[nodeName === 'Model Node 2' ? 'model-node-2' : nodeName === 'Model Node 1' ? 'model-node-1' : nodeName === 'Redis Cache' ? 'redis' : 'orchestrator'];
    
    nameEl.textContent = nodeName.toUpperCase();
    stateEl.textContent = nodeStatus;
    stateEl.className = nodeStatus === 'ONLINE' ? 'text-success' : 'text-danger';
    
    if (nodeStatus === 'ONLINE') {
      if (AppState.telemetryData) {
        if (key === 'client') {
          cpuEl.textContent = '2%';
          memEl.textContent = '14MB';
        } else {
          const cpuVal = AppState.telemetryData.cpu[key] || 0;
          const memVal = AppState.telemetryData.memory[key] || 0;
          cpuEl.textContent = `${cpuVal}%`;
          if (key === 'node1' || key === 'node2') {
            memEl.textContent = `${memVal.toFixed(1)}GB`;
          } else {
            memEl.textContent = `${memVal}MB`;
          }
        }
      } else {
        cpuEl.textContent = nodeInfo.cpu;
        memEl.textContent = nodeInfo.mem;
      }
    } else {
      cpuEl.textContent = '0%';
      memEl.textContent = '100% (OOM)';
    }
  }


  drawNode(x, y, name, status) {
    const isOnline = status === 'ONLINE';
    const dotColor = isOnline ? '#10b981' : '#ef4444';
    const isHovered = this.hoveredNode === name;
    
    const width = 120;
    const height = 36;
    const rx = x - width / 2;
    const ry = y - height / 2;

    // 1. Draw capsule card background (Flat, Render-style outline)
    this.ctx.save();
    this.ctx.fillStyle = '#12141c';
    this.ctx.strokeStyle = isHovered ? '#8a05ff' : '#1d1e26';
    this.ctx.lineWidth = isHovered ? 1.5 : 1;
    this.ctx.beginPath();
    this.ctx.roundRect(rx, ry, width, height, 6);
    this.ctx.fill();
    this.ctx.stroke();
    this.ctx.restore();

    // 2. Draw simple clean status dot on left
    this.ctx.beginPath();
    this.ctx.arc(rx + 14, y, 4, 0, 2 * Math.PI);
    this.ctx.fillStyle = dotColor;
    this.ctx.fill();

    // 3. Render Text Labels (Clean Inter/Mono styles)
    this.ctx.save();
    // Name
    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.font = '600 9px "Inter", sans-serif';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(name, rx + 26, y - 3);

    // Sub-text IP
    const nodeInfo = AppState.nodeRegistry[name];
    this.ctx.fillStyle = '#6b7280';
    this.ctx.font = '500 8px "JetBrains Mono", monospace';
    this.ctx.fillText(nodeInfo.ip, rx + 26, y + 8);
    this.ctx.restore();
  }

  drawConnector(x1, y1, x2, y2, color, isDashed = false, animate = false) {
    // Flat clean single lines
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.2;
    if (isDashed) {
      this.ctx.setLineDash([4, 4]);
      if (animate) {
        this.ctx.lineDashOffset = this.dashOffset;
      }
    }
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  render() {
    // Solid flat background, no opacity trails
    this.ctx.fillStyle = '#0c0d12';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.dashOffset -= 0.5;
    if (this.dashOffset < -80) this.dashOffset = 0;

    // Connections drawing
    this.drawConnector(this.nodes['Client'].x, this.nodes['Client'].y, this.nodes['Gateway'].x, this.nodes['Gateway'].y, 'rgba(138, 5, 255, 0.4)', false);
    this.drawConnector(this.nodes['Gateway'].x, this.nodes['Gateway'].y, this.nodes['Router'].x, this.nodes['Router'].y, 'rgba(138, 5, 255, 0.4)', false);
    this.drawConnector(this.nodes['Router'].x, this.nodes['Router'].y, this.nodes['Redis Cache'].x, this.nodes['Redis Cache'].y, '#1d1e26', true, true);

    let routeColor = '#1d1e26';
    let isBypass = false;
    let isNode2Online = AppState.nodeStates['model-node-2'] === 'ONLINE';

    if (AppState.activeRoute === 'rdma-bypass') {
      routeColor = '#8a05ff';
      isBypass = true;
    } else if (AppState.activeRoute === 'rdma-single') {
      routeColor = '#8a05ff';
      isBypass = true;
    } else if (AppState.activeRoute === 'tcp-fallback') {
      routeColor = '#f59e0b';
    } else if (AppState.activeRoute === 'tcp-failover-single') {
      routeColor = '#ef4444';
    }

    this.drawConnector(this.nodes['Router'].x, this.nodes['Router'].y, this.nodes['Model Node 1'].x, this.nodes['Model Node 1'].y, routeColor, true, true);

    if (isNode2Online) {
      this.drawConnector(this.nodes['Router'].x, this.nodes['Router'].y, this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, routeColor, true, true);
    } else {
      this.drawConnector(this.nodes['Router'].x, this.nodes['Router'].y, this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, 'rgba(239, 68, 68, 0.2)', true, false);
    }

    if (isBypass && isNode2Online) {
      this.drawConnector(this.nodes['Model Node 1'].x, this.nodes['Model Node 1'].y, this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, '#8a05ff', false);
      
      // Clean small flow particle dot
      this.ctx.beginPath();
      const particleProgress = (Math.abs(this.dashOffset) % 100) / 100;
      const particleY = this.nodes['Model Node 1'].y + particleProgress * (this.nodes['Model Node 2'].y - this.nodes['Model Node 1'].y);
      this.ctx.arc(this.nodes['Model Node 1'].x, particleY, 2.5, 0, 2 * Math.PI);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fill();
    } else {
      // TCP Fallback or Offline status
      const linkColor = !isNode2Online ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 9, 0.45)';
      
      if (isNode2Online) {
        // Route through Host OS staging node
        this.drawConnector(this.nodes['Model Node 1'].x, this.nodes['Model Node 1'].y, this.nodes['Host OS'].x, this.nodes['Host OS'].y, linkColor, true, true);
        this.drawConnector(this.nodes['Host OS'].x, this.nodes['Host OS'].y, this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, linkColor, true, true);
        
        // Flow particles through Host OS staging path
        const particleProgress = (Math.abs(this.dashOffset) % 100) / 100;
        
        this.ctx.beginPath();
        const px1 = this.nodes['Model Node 1'].x + particleProgress * (this.nodes['Host OS'].x - this.nodes['Model Node 1'].x);
        const py1 = this.nodes['Model Node 1'].y + particleProgress * (this.nodes['Host OS'].y - this.nodes['Model Node 1'].y);
        this.ctx.arc(px1, py1, 2.5, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#f59e0b';
        this.ctx.fill();
        
        this.ctx.beginPath();
        const px2 = this.nodes['Host OS'].x + particleProgress * (this.nodes['Model Node 2'].x - this.nodes['Host OS'].x);
        const py2 = this.nodes['Host OS'].y + particleProgress * (this.nodes['Host OS'].y - this.nodes['Host OS'].y);
        this.ctx.arc(px2, py2, 2.5, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#f59e0b';
        this.ctx.fill();
      } else {
        // Connect directly with red error line if crashed
        this.drawConnector(this.nodes['Model Node 1'].x, this.nodes['Model Node 1'].y, this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, 'rgba(239, 68, 68, 0.15)', true, false);
      }
    }

    // Nodes drawing
    this.drawNode(this.nodes['Client'].x, this.nodes['Client'].y, 'Client', 'ONLINE');
    this.drawNode(this.nodes['Gateway'].x, this.nodes['Gateway'].y, 'Gateway', AppState.nodeStates['fastapi-gateway']);
    this.drawNode(this.nodes['Router'].x, this.nodes['Router'].y, 'Router', AppState.nodeStates['orchestrator']);
    this.drawNode(this.nodes['Redis Cache'].x, this.nodes['Redis Cache'].y, 'Redis Cache', AppState.nodeStates['redis']);
    this.drawNode(this.nodes['Host OS'].x, this.nodes['Host OS'].y, 'Host OS', 'ONLINE');
    this.drawNode(this.nodes['Model Node 1'].x, this.nodes['Model Node 1'].y, 'Model Node 1', AppState.nodeStates['model-node-1']);
    this.drawNode(this.nodes['Model Node 2'].x, this.nodes['Model Node 2'].y, 'Model Node 2', AppState.nodeStates['model-node-2']);
  }
}

// 3. CHART METRICS MANAGER
class TelemetryChartManager {
  constructor() {
    this.timeLabels = [];
    this.throughputHistory = [];
    this.latencyHistory = [];
    this.driftHistory = [];
    this.maxPoints = 20;
    
    this.init();
  }

  init() {
    // Shared defaults
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = "'Inter', sans-serif";
    
    const ctxTpLt = document.getElementById('chart-throughput-latency').getContext('2d');
    
    // Subtle gradients
    const gradTp = ctxTpLt.createLinearGradient(0, 0, 0, 150);
    gradTp.addColorStop(0, 'rgba(138, 5, 255, 0.05)');
    gradTp.addColorStop(1, 'rgba(138, 5, 255, 0.0)');
    
    const gradLt = ctxTpLt.createLinearGradient(0, 0, 0, 150);
    gradLt.addColorStop(0, 'rgba(16, 185, 129, 0.05)');
    gradLt.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    this.tpLtChart = new Chart(ctxTpLt, {
      type: 'line',
      data: {
        labels: this.timeLabels,
        datasets: [
          {
            label: 'Throughput (tok/s)',
            data: this.throughputHistory,
            borderColor: '#8a05ff',
            backgroundColor: gradTp,
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y-tp',
            tension: 0.35,
            fill: true
          },
          {
            label: 'Latency (ms)',
            data: this.latencyHistory,
            borderColor: '#10b981',
            backgroundColor: gradLt,
            borderWidth: 1.5,
            pointRadius: 0,
            yAxisID: 'y-lt',
            tension: 0.35,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 10, font: { size: 9 } }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.015)' },
            ticks: { font: { size: 8 } }
          },
          'y-tp': {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 300,
            grid: { color: 'rgba(255,255,255,0.015)' },
            title: { display: false }
          },
          'y-lt': {
            type: 'linear',
            position: 'right',
            min: 0,
            max: 250,
            grid: { drawOnChartArea: false },
            title: { display: false }
          }
        }
      }
    });

    const ctxDrift = document.getElementById('chart-drift').getContext('2d');
    const gradDrift = ctxDrift.createLinearGradient(0, 0, 0, 150);
    gradDrift.addColorStop(0, 'rgba(239, 68, 68, 0.05)');
    gradDrift.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

    this.driftChart = new Chart(ctxDrift, {
      type: 'line',
      data: {
        labels: this.timeLabels,
        datasets: [{
          label: 'Data Drift Anomaly Index',
          data: this.driftHistory,
          borderColor: '#ef4444',
          backgroundColor: gradDrift,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 10, font: { size: 9 } }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.015)' }, ticks: { font: { size: 8 } } },
          y: {
            min: 0,
            max: 1.0,
            grid: { color: 'rgba(255,255,255,0.015)' },
            title: { display: false }
          }
        }
      }
    });
  }

  update(timestamp, tp, lt, df) {
    const timeStr = timestamp.split('T')[1].substring(0, 8); // hh:mm:ss
    
    this.timeLabels.push(timeStr);
    this.throughputHistory.push(tp);
    this.latencyHistory.push(lt);
    this.driftHistory.push(df);

    if (this.timeLabels.length > this.maxPoints) {
      this.timeLabels.shift();
      this.throughputHistory.shift();
      this.latencyHistory.shift();
      this.driftHistory.shift();
    }

    this.tpLtChart.update('none'); // silent update for performance
    this.driftChart.update('none');
  }
}

// 4. MAIN DASHBOARD CONTROLLER
class DashboardController {
  constructor() {
    this.canvasMgr = new CanvasGridManager('rdma-canvas');
    this.chartMgr = new TelemetryChartManager();
    this.sseSource = null;
    
    this.initViews();
    this.initSSE();
    this.initUIEvents();
    
    // Start canvas loop
    const loop = () => {
      if (this.canvasMgr) this.canvasMgr.render();
      requestAnimationFrame(loop);
    };
    loop();
  }

  initViews() {
    // Handles sidebar view swapping
    const navItems = document.querySelectorAll('.nav-item');
    const panels = document.querySelectorAll('.view-panel');
    const viewTitle = document.getElementById('view-title');
    const viewDesc = document.getElementById('view-desc');
    
    const descriptions = {
      'dashboard': { title: 'Control Dashboard', desc: 'Real-time telemetry, routing tables, and MLOps sandbox.' },
      'topology': { title: 'Topology Grid', desc: 'Active inter-node memory channel bypass mapping.' },
      'logs': { title: 'Console Logs', desc: 'Aggregated stdout/stderr logs from cluster containers.' }
    };

    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const viewName = item.getAttribute('data-view');
        
        // Swap navigation active class
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        // Swap visibility
        panels.forEach(p => p.classList.add('hidden'));
        document.getElementById(`view-${viewName}`).classList.remove('hidden');
        
        // Update headers
        viewTitle.textContent = descriptions[viewName].title;
        viewDesc.textContent = descriptions[viewName].desc;
        
        AppState.activeView = viewName;
        
        // If switching to topology, force canvas resize recalculation
        if (viewName === 'topology') {
          this.canvasMgr.resize();
        } else if (viewName === 'logs') {
          if (AppState.currentLogTab === 'fastapi-gateway') {
            setTimeout(() => this.checkForToxicHighlight(), 150);
          }
        }
      });
    });

    // Logs Tab Swapping
    const tabButtons = document.querySelectorAll('.log-tab');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        
        const container = btn.getAttribute('data-container');
        AppState.currentLogTab = container;
        this.renderLogBuffer();
        if (container === 'fastapi-gateway') {
          this.checkForToxicHighlight();
        }
      });
    });
  }

  initSSE() {
    const connStatusText = document.getElementById('sidebar-status-text');
    const connStatusDot = document.getElementById('sidebar-status-dot');
    const globalHealthVal = document.getElementById('system-health');
    const node2RegStatus = document.getElementById('reg-node2-status');
    
    this.sseSource = new EventSource('/api/stream');

    this.sseSource.onopen = () => {
      connStatusText.textContent = 'CONNECTED';
      connStatusText.className = 'status-desc text-success';
      connStatusDot.className = 'status-dot-pulse green';
    };

    this.sseSource.onerror = () => {
      connStatusText.textContent = 'RECONNECTING';
      connStatusText.className = 'status-desc text-danger';
      connStatusDot.className = 'status-dot-pulse red';
    };

    // Telemetry updates
    this.sseSource.addEventListener('telemetry', (e) => {
      const data = JSON.parse(e.data);
      
      // Update DOM values
      document.getElementById('val-throughput').textContent = data.throughput.toFixed(2);
      document.getElementById('val-latency').textContent = data.latency.toFixed(2);
      document.getElementById('val-drift').textContent = data.drift.toFixed(3);
      
      AppState.nodeStates = data.nodeStates;
      AppState.activeRoute = data.activeRoute;
      
      // Update Registry Status displays
      const node2Status = AppState.nodeStates['model-node-2'];
      node2RegStatus.textContent = node2Status;
      if (node2Status === 'ONLINE') {
        node2RegStatus.className = 'reg-status green';
      } else if (node2Status === 'RESTARTING') {
        node2RegStatus.className = 'reg-status text-warning';
      } else {
        node2RegStatus.className = 'reg-status red';
      }

      // Check overall system health
      if (data.nodeStates['model-node-2'] === 'OFFLINE') {
        globalHealthVal.textContent = 'DEGRADED';
        globalHealthVal.className = 'pill-value text-danger';
      } else if (data.nodeStates['model-node-2'] === 'RESTARTING') {
        globalHealthVal.textContent = 'RECOVERING';
        globalHealthVal.className = 'pill-value text-warning';
      } else if (data.throughput > 150) {
        globalHealthVal.textContent = 'STRESSED';
        globalHealthVal.className = 'pill-value text-warning';
      } else {
        globalHealthVal.textContent = 'NOMINAL';
        globalHealthVal.className = 'pill-value text-accent';
      }

      // Update Charts
      this.chartMgr.update(data.timestamp, data.throughput, data.latency, data.drift);
    });

    // Real-time Logs updates
    this.sseSource.addEventListener('log', (e) => {
      const logObj = JSON.parse(e.data);
      
      // Append to specific container buffer
      const buffer = AppState.logBuffers[logObj.container];
      buffer.push(logObj);
      if (buffer.length > 150) buffer.shift();
      
      // Render immediately if currently active tab
      if (logObj.container === AppState.currentLogTab) {
        this.appendLogLineToScreen(logObj);
      }
    });
  }

  appendLogLineToScreen(logObj) {
    const screen = document.getElementById('terminal-screen');
    const autoscroll = document.getElementById('chk-autoscroll').checked;
    
    const timeStr = logObj.timestamp.split('T')[1].substring(0, 8);
    const row = document.createElement('div');
    row.className = 'log-row';
    if (logObj.isToxicIntercept) {
      row.setAttribute('data-toxic-intercept', 'true');
    }
    
    let levelClass = 'lvl-info';
    if (logObj.level === 'WARN') levelClass = 'lvl-warn';
    else if (logObj.level === 'ERROR') levelClass = 'lvl-error';
    else if (logObj.level === 'SYSTEM') levelClass = 'lvl-system';
    
    row.innerHTML = `
      <span class="log-time">${timeStr}</span>
      <span class="log-level ${levelClass}">${logObj.level}</span>
      <span class="log-text">${logObj.message}</span>
    `;
    
    screen.appendChild(row);
    if (autoscroll) {
      const container = screen.parentElement;
      container.scrollTop = container.scrollHeight;
    }
  }

  renderLogBuffer() {
    const screen = document.getElementById('terminal-screen');
    screen.innerHTML = ''; // Clear viewport
    
    const currentBuffer = AppState.logBuffers[AppState.currentLogTab];
    currentBuffer.forEach(logObj => {
      this.appendLogLineToScreen(logObj);
    });
  }

  checkForToxicHighlight() {
    // Only check if we are in logs view and on fastapi-gateway tab
    if (AppState.activeView !== 'logs' || AppState.currentLogTab !== 'fastapi-gateway') return;

    const screen = document.getElementById('terminal-screen');
    const rows = screen.querySelectorAll('.log-row');
    
    let targetRow = null;
    rows.forEach(row => {
      if (row.getAttribute('data-toxic-intercept') === 'true') {
        targetRow = row;
      }
    });

    if (targetRow) {
      // Highlight row
      targetRow.classList.add('highlight-toxic-row');
      
      // Auto-scroll the terminal panel to bring this warning row to the center
      const viewport = screen.parentElement;
      setTimeout(() => {
        const rowOffsetTop = targetRow.offsetTop;
        const viewportHeight = viewport.clientHeight;
        viewport.scrollTop = rowOffsetTop - (viewportHeight / 2) + (targetRow.clientHeight / 2);
      }, 100);

      // Trigger modern toast notification pop up inside terminal
      this.showLogsToast('⚠️ SECURITY ALIGNMENT: Intercepted payload trace highlighted below');
    }
  }

  showLogsToast(message) {
    const existing = document.querySelector('.log-alert-toast');
    if (existing) existing.remove();

    const viewport = document.querySelector('.logs-terminal-viewport');
    if (!viewport) return;

    const toast = document.createElement('div');
    toast.className = 'log-alert-toast';
    toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${message}</span>`;
    viewport.appendChild(toast);

    // Auto fade out
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  initUIEvents() {
    // API actions
    document.getElementById('btn-inject-oom').addEventListener('click', () => {
      fetch('/api/inject-oom', { method: 'POST' });
    });

    document.getElementById('btn-recover').addEventListener('click', () => {
      fetch('/api/recover-node', { method: 'POST' });
    });

    document.getElementById('btn-reset').addEventListener('click', () => {
      fetch('/api/reset', { method: 'POST' });
    });

    document.getElementById('btn-clear-logs').addEventListener('click', () => {
      document.getElementById('terminal-screen').innerHTML = '';
      AppState.logBuffers[AppState.currentLogTab] = [];
    });

    // Checkbox toggles
    document.getElementById('chk-stress').addEventListener('change', (e) => {
      fetch('/api/stress-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: e.target.checked })
      });
    });

    document.getElementById('chk-rdma-congest').addEventListener('change', (e) => {
      fetch('/api/rdma-congestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: e.target.checked })
      });
    });


    // Prompt Auditing simulation
    const btnSubmit = document.getElementById('btn-submit-chain');
    const promptInput = document.getElementById('prompt-input');
    const chkToxic = document.getElementById('chk-toxic');
    const outputBox = document.getElementById('output-box');

    btnSubmit.addEventListener('click', () => {
      const promptVal = promptInput.value.trim();
      if (!promptVal) return;

      btnSubmit.disabled = true;
      outputBox.className = 'outbound-output-screen';
      outputBox.textContent = 'Analyzing request tokens and initializing guardrail audit...';
      
      const steps = ['node-gateway', 'node-guardrail', 'node-cache', 'node-orchestrator', 'node-inference'];
      steps.forEach(id => {
        const el = document.getElementById(id);
        el.className = 'flow-step';
        el.querySelector('.flow-time').textContent = '-';
      });
      const connectors = ['link-1', 'link-2', 'link-3', 'link-4'];
      connectors.forEach(id => document.getElementById(id).className = 'flow-connector');

      const isToxic = chkToxic.checked || /hack|bypass|exploit|kill/i.test(promptVal);

      // Step-by-step pipeline visualization
      setTimeout(() => {
        // Step 1: Gateway
        const gateNode = document.getElementById('node-gateway');
        gateNode.classList.add('active-success');
        gateNode.querySelector('.flow-time').textContent = '2ms';
        document.getElementById('link-1').className = 'flow-connector active-link';

        setTimeout(() => {
          // Step 2: Guardrails
          const guardNode = document.getElementById('node-guardrail');
          if (isToxic) {
            guardNode.classList.add('active-failed');
            guardNode.querySelector('.flow-time').textContent = '4ms';
            outputBox.className = 'outbound-output-screen blocked';
            outputBox.textContent = 'SECURITY CRITICAL EXCEPTION: Prompt injection pattern detected by toxicity classifier. Workload routing blocked.';
            
            // Push simulated warning trace to FastAPI Gateway log buffer
            const logEntry = {
              timestamp: new Date().toISOString(),
              level: 'WARN',
              container: 'fastapi-gateway',
              message: `GUARDRAIL CRITICAL: Toxic/injection payload intercepted. Query matches toxic signatures. Routing BLOCKED. Payload: "${promptVal.substring(0, 50)}..."`,
              isToxicIntercept: true
            };
            AppState.logBuffers['fastapi-gateway'].push(logEntry);
            
            btnSubmit.disabled = false;
          } else {
            guardNode.classList.add('active-success');
            guardNode.querySelector('.flow-time').textContent = '4ms';
            document.getElementById('link-2').className = 'flow-connector active-link';

            setTimeout(() => {
              // Step 3: Cache (Redis)
              const cacheNode = document.getElementById('node-cache');
              const isCacheHit = (promptVal === AppState.lastPrompt);
              AppState.lastPrompt = promptVal;
              
              cacheNode.classList.add('active-success');
              cacheNode.querySelector('.flow-time').textContent = '1ms';
              if (isCacheHit) {
                // Instantly failover to output (bypass router)
                outputBox.className = 'outbound-output-screen success';
                outputBox.textContent = 'CACHE HIT [Semantic Key Match]: Returning compiled weights directly.\nCost Saving: 100% tokens saved.\nResult: FlynthAI Grid direct cache output.';
                
                // Push simulated hit log to Redis log buffer
                const logEntry = {
                  timestamp: new Date().toISOString(),
                  level: 'INFO',
                  container: 'redis',
                  message: `CACHE_HIT: Semantic similarity match above threshold. Query matched previous prompt. Returning weights directly.`
                };
                AppState.logBuffers['redis'].push(logEntry);
                
                btnSubmit.disabled = false;
              } else {
                document.getElementById('link-3').className = 'flow-connector active-link';
                setTimeout(() => {
                  // Step 4: Router (Orchestrator)
                  const routerNode = document.getElementById('node-orchestrator');
                  routerNode.classList.add('active-success');
                  routerNode.querySelector('.flow-time').textContent = '6ms';
                  document.getElementById('link-4').className = 'flow-connector active-link';

                  setTimeout(() => {
                    // Step 5: Inference
                    const infNode = document.getElementById('node-inference');
                    infNode.classList.add('active-success');
                    infNode.querySelector('.flow-time').textContent = '112ms';
                    outputBox.className = 'outbound-output-screen success';
                    
                    let cleanPromptText = promptVal;
                    // Mock PII scrub
                    if (/\S+@\S+\.\S+/.test(cleanPromptText)) {
                      cleanPromptText = cleanPromptText.replace(/\S+@\S+\.\S+/g, '[EMAIL_REDACTED]');
                      outputBox.className = 'outbound-output-screen blocked'; // alert status
                    }
                    
                    outputBox.textContent = `COMPLETED SUCCESSFULLY.\nPII Scrub: OK.\nInference Node: H100 GPU\nOutput Payload: FlynthAI-Grid processed successfully. Prompt digest: "${cleanPromptText.substring(0, 30)}..."`;
                    btnSubmit.disabled = false;
                  }, 600);
                }, 400);
              }
            }, 400);
          }
        }, 400);
      }, 400);
    });
  }
}

// 5. BOOTSTRAP INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
  window.Dashboard = new DashboardController();
});
