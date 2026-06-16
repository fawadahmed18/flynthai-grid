import http.server
import json
import sys
import time

class MockModelNodeHandler(http.server.BaseHTTPRequestHandler):
    oom_triggered = False

    def do_GET(self):
        if self.path == '/health':
            if MockModelNodeHandler.oom_triggered:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "OOM_ERROR", "error": "CUDA out of memory"}).encode())
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "healthy"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        # Read post body
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')

        # Check for simulated trigger to crash with OOM or timeout
        if "trigger-oom" in post_data:
            MockModelNodeHandler.oom_triggered = True
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "RuntimeError: CUDA out of memory. Tried to allocate 8.00 GiB"}).encode())
            return
        elif "trigger-timeout" in post_data:
            time.sleep(15) # Sleep longer than orchestrator 10s limit to force timeout
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"response": "Completed after delay"}).encode())
            return

        # Normal successful inference
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            "response": "Generated output from mock model node",
            "metadata": {"compute_time_ms": 120}
        }).encode())

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    server_address = ('0.0.0.0', port)
    httpd = http.server.HTTPServer(server_address, MockModelNodeHandler)
    print(f"Mock Model Node running on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
