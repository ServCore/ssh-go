SHELL := /bin/bash
.DEFAULT_GOAL := run
.PHONY: help setup run build check test-go test-ui memory

help:
	@echo 'setup     Install frontend dependencies and test browser'
	@echo 'run       Start the Wails desktop app'
	@echo 'build     Package the desktop app in build/bin/'
	@echo 'check     Build frontend, vet Go, run Go and UI tests'
	@echo 'test-go   Run backend tests with the race detector'
	@echo 'test-ui   Run frontend UI tests'
	@echo 'memory    Profile production frontend memory'

setup:
	@npm --prefix frontend ci
	@cd frontend && npx playwright install chromium

run:
	@node scripts/wails.mjs dev

build:
	@node scripts/wails.mjs build -clean

check:
	@npm --prefix frontend run build
	@go vet ./...
	@go test -race ./internal/...
	@npm --prefix frontend test

test-go:
	@go test -race ./internal/...

test-ui:
	@npm --prefix frontend test

memory:
	@npm --prefix frontend run profile:memory
