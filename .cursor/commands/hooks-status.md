# Check Hooks Status

Check if observability hooks are currently enabled or disabled.

Run this bash command:

```bash
if [ -f .cursor/hooks.json ]; then
  echo "✓ Hooks ENABLED"
  echo "  Dashboard: http://localhost:5273/observability"
elif [ -f .cursor/hooks.json.disabled ]; then
  echo "○ Hooks DISABLED"
  echo "  Run /hooks-on to enable"
else
  echo "✗ Hooks NOT CONFIGURED"
fi
```
