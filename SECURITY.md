# Security policy

## Supported versions

Only the latest published `1.x` release receives fixes.

## Reporting a vulnerability

Do not file public issues for suspected vulnerabilities. Contact the repository owner privately with a minimal reproduction, affected platform/version, and expected impact. Avoid attaching production databases or credentials.

## Security boundaries

This library prevents accidental file-path traversal by accepting a constrained database file name, and it supports native positional parameter binding. It cannot make dynamically supplied SQL safe: treat SQL text as trusted application code and bind untrusted values with `?` parameters.
