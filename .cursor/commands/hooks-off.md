# Disable Observability Hooks

Disable telemetry hooks for this project by renaming the hooks.json file.

Run this bash command:

```bash
mv .cursor/hooks.json .cursor/hooks.json.disabled 2>/dev/null && echo "✓ Hooks disabled - telemetry stopped" || echo "Hooks already disabled or not found"
```
