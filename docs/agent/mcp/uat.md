# Hosted MCP acceptance

Target: the production alias, using a new grant from Settings → MCP Access
Control. Create a read-only grant for discovery and a separate read-and-write
grant for mutation acceptance. Each grant yields its full connector URL once.
Keep credentials in the connector or local environment.

## Read-only checkpoint

Connect the client and inspect tool discovery. Every tool has input/output
schemas and annotations; read-only discovery contains only read operations.
Read the workspace configuration and notebooks, then exercise ls, glob, read and
find against an existing example note. Compare paths, raw Markdown, frontmatter
and revisions with the website and GitHub. Custom notebook statuses appear in
the returned manifest; unlisted note statuses retain their exact values.

## Write checkpoint

Use a unique `mcp-uat-<timestamp>` directory inside a configured notebook. Obtain
a fresh revision before each mutation. Run mkdir, write, read, append, positional
edit, glob, find, cp, mv and rm. Inspect each receipt and corresponding GitHub
commit: one successful mutation produces one commit with a program-generated
message. Confirm edited lines and preserved surrounding text through read.
Retry a mutation with a stale revision and confirm an error and no extra commit.
Finish by removing the test directory with explicit recursive consent, then
confirm it is absent. Keep all test writes inside that unique directory.

## Visibility checkpoint

Within the temporary directory, create a note with status archived and hiden:
true. Confirm it is absent from the default website view and appears when Sidebar
Show hidden notes is enabled. MCP read still returns it. Change hiden to false
and confirm it appears normally; a custom status also appears as an additional
notebook choice. Hidden is display behavior, so MCP reads remain complete.

## Grant checkpoint

Confirm the new grants are labeled Until revoked. Sign out of the website and
repeat a read with the connector; it remains valid. Sign in and revoke the test
grant, then confirm subsequent calls receive an authorization error. Record the
client's connector warnings separately from protocol/tool errors, including the
specific tool and schema field if a warning occurs.

Record results and commit receipts in the active release verification document.
Actual ChatGPT connector behavior is a separate checkpoint from SDK and HTTP
checks performed during development.
