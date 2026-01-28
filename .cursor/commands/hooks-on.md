# Enable Observability Hooks

Enable telemetry hooks for this project by restoring the hooks.json file.

Run this bash command:

```bash
mv .cursor/hooks.json.disabled .cursor/hooks.json 2>/dev/null && echo "✓ Hooks enabled - telemetry active" || echo "Hooks already enabled or not found"
```

Dashboard: http://localhost:5273/observability
