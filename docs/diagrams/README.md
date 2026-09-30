# Diagram sources

`architecture-overview.py` generates the platform overview
(`../architecture-overview.png`). It is a plain Python script that emits SVG —
no build tooling, no diagram-as-code dependency to install.

```bash
python3 docs/diagrams/architecture-overview.py            # writes the SVG
google-chrome --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1700,860 \
  --screenshot=docs/architecture-overview.png \
  "file://$PWD/docs/diagrams/wrap.html"
```

The script is kept because the diagram has already gone stale once. Every arrow
in it corresponds to a real call path, so when one changes the picture should
change with it:

| Arrow | Where it lives in the code |
|---|---|
| Identity assertion | `apps/api/src/routes/sso.ts` |
| Pre-fill (synchronous, not queued) | `packages/core/src/prefill/index.ts` |
| Verification reads | `packages/core/src/workflow/engine.ts` → `handleDepartmentLookup` |
| Decisions written back | `packages/core/src/workflow/engine.ts` → `handleWriteBack` |
| Health checks | `packages/core/src/connector-registry.ts` |

Which departments receive decisions is not a drawing choice — it is
`decisionChannel` in `packages/contracts/src/departments.ts`. Identity and the
legacy CSV export are `null` there, which is why no write arrow reaches them.
