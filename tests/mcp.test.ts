import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConnectors, parseMcpGet } from '../src/main/mcp'

test('lê o estado do `claude mcp get`', () => {
  assert.equal(parseMcpGet('ccc-jira:\n  Scope: User\n  Status: ✓ Connected\n', 'x', true).state, 'ok')
  const broken = parseMcpGet('  Status: ✘ Failed to connect\n  Issue: ENOENT: Executable not found in $PATH: "uvx"', 'x', true)
  assert.equal(broken.state, 'fail')
  assert.match(broken.detail, /instale o uv/)
  assert.equal(parseMcpGet('  Status: ⚠ Needs authentication', 'x', true).state, 'warn')
  assert.equal(parseMcpGet('No MCP server named "ccc-jira".', 'x', false).state, 'off')
  assert.equal(parseMcpGet('No MCP server named "ccc-jira".', 'x', true).state, 'fail')
})

test('acha os conectores da conta claude.ai no `claude mcp list`', () => {
  const out = [
    'Checking MCP server health…',
    '',
    'claude.ai Atlassian MCP: https://mcp.atlassian.com/v1/sse - ✓ Connected',
    'claude.ai Claude Docs: https://x - ✗ Failed to connect',
    'ccc-gchat: https://chatmcp.googleapis.com/mcp/v1 (HTTP) - ✓ Connected'
  ].join('\n')
  assert.deepEqual(parseConnectors(out), ['Atlassian MCP', 'Claude Docs (sem conexão)'])
})
