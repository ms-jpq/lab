.PHONY: dev

dev: .codex/config.toml
.codex/config.toml: .codex/config.tpl.toml .facts/mcp.env
	set -a
	source -- .facts/mcp.env
	set +a
	envsubst < '$<' > '$@'
