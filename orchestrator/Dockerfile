FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod ./
# No external dependencies are used; standard library is sufficient.

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o orchestrator main.go

FROM alpine:latest

RUN apk --no-cache add ca-certificates curl

WORKDIR /root/

COPY --from=builder /app/orchestrator .

# Expose HTTP proxy port and admin dashboard/metrics
EXPOSE 8080

CMD ["./orchestrator"]
