# Deployment

This repo is being transformed from a general Work Management platform into the **Field Service
& Proof of Execution** product — see `docs/field-service-audit.md` and
`docs/field-service-architecture.md` for the full context.

For the actual step-by-step Supabase + Vercel setup (manual, no automated Claude/MCP
provisioning), see:

**→ [docs/field-service-deployment-guide.md](docs/field-service-deployment-guide.md)**

## How the three services relate

| Service | Holds | Updates when |
|---|---|---|
| **GitHub** | Source code | Every `git push` |
| **Vercel** | Build/deploy of the code from GitHub | Automatically on push to whichever branch is set as Production Branch in Project Settings → Git |
| **Supabase** | Database schema + data | Never automatically — migration SQL must be run manually in the SQL Editor |

Development currently happens on branch `claude/field-service-transformation-6qq2js` (not
`main` — `main` still holds the pre-transformation codebase and does not match the current
database schema).
