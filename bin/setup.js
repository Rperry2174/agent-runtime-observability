#!/usr/bin/env node
/**
 * Agent Observability Setup Script
 *
 * Configures Cursor hooks for telemetry collection.
 * Run from a project directory: node /path/to/agent-runtime-observability/bin/setup.js setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBSERVABILITY_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = process.cwd();
const SERVER_PORT = 5274;
const CLIENT_PORT = 5273;

// Hook path (absolute)
const TELEMETRY_HOOK = path.join(OBSERVABILITY_ROOT, 'hooks', 'telemetry-hook.sh');

// ============================================================================
// Cursor Configuration
// ============================================================================

const cursorHooksConfig = {
  version: 1,
  hooks: {
    // Session lifecycle (sessionStart omitted - runs start on first prompt submission)
    sessionEnd: [{ command: `${TELEMETRY_HOOK} sessionEnd` }],
    
    // Tool lifecycle (generic - fires for all tools)
    preToolUse: [{ command: `${TELEMETRY_HOOK} toolStart` }],
    postToolUse: [{ command: `${TELEMETRY_HOOK} toolEnd` }],
    postToolUseFailure: [{ command: `${TELEMETRY_HOOK} toolFailure` }],
    
    // Shell execution (more detailed than generic tool hooks)
    beforeShellExecution: [{ command: `${TELEMETRY_HOOK} shellStart` }],
    afterShellExecution: [{ command: `${TELEMETRY_HOOK} shellEnd` }],
    
    // MCP execution
    afterMCPExecution: [{ command: `${TELEMETRY_HOOK} mcpEnd` }],
    
    // File edits
    afterFileEdit: [{ command: `${TELEMETRY_HOOK} fileEditEnd` }],
    
    // Tab file operations
    beforeTabFileRead: [{ command: `${TELEMETRY_HOOK} tabReadStart` }],
    afterTabFileEdit: [{ command: `${TELEMETRY_HOOK} tabEditEnd` }],
    
    // Subagent lifecycle
    subagentStart: [{ command: `${TELEMETRY_HOOK} subagentStart` }],
    subagentStop: [{ command: `${TELEMETRY_HOOK} subagentStop` }],
    
    // Agent thinking and responses
    afterAgentThought: [{ command: `${TELEMETRY_HOOK} thinkingEnd` }],
    afterAgentResponse: [{ command: `${TELEMETRY_HOOK} agentResponse` }],
    
    // Context compaction
    preCompact: [{ command: `${TELEMETRY_HOOK} contextCompact` }],
    
    // Completion status
    stop: [{ command: `${TELEMETRY_HOOK} stop` }],
    
    // Attachments visibility (rules, files)
    beforeReadFile: [{ command: `${TELEMETRY_HOOK} toolStart` }],
    beforeSubmitPrompt: [{ command: `${TELEMETRY_HOOK} beforeSubmitPrompt` }],
  }
};


// ============================================================================
// Utilities
// ============================================================================

function isPortInUse(port) {
  return new Promise((resolve) => {
    exec(`lsof -i :${port} -t`, (err, stdout) => {
      resolve(stdout.trim().length > 0);
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' :
              process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`);
}

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting observability server...\n');

    const child = spawn('npm', ['run', 'dev'], {
      cwd: OBSERVABILITY_ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, PROJECT_ROOT: TARGET_DIR }
    });

    setTimeout(() => resolve(child), 3000);
    child.on('error', reject);
  });
}

// ============================================================================
// Setup Functions
// ============================================================================

function setupCursorHooks() {
  const cursorDir = path.join(TARGET_DIR, '.cursor');
  if (!fs.existsSync(cursorDir)) {
    fs.mkdirSync(cursorDir, { recursive: true });
  }

  const hooksPath = path.join(cursorDir, 'hooks.json');
  fs.writeFileSync(hooksPath, JSON.stringify(cursorHooksConfig, null, 2));
  console.log('  Configured .cursor/hooks.json (Cursor)');
}

function setupSlashCommands() {
  const cursorDir = path.join(TARGET_DIR, '.cursor');
  const commandsDir = path.join(cursorDir, 'commands');

  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  // Create /hooks-off command
  const hooksOffContent = `# Disable Observability Hooks

Disable telemetry hooks for this project by renaming the hooks.json file.

Run this bash command:

\`\`\`bash
mv .cursor/hooks.json .cursor/hooks.json.disabled 2>/dev/null && echo "✓ Hooks disabled - telemetry stopped" || echo "Hooks already disabled or not found"
\`\`\`
`;

  // Create /hooks-on command
  const hooksOnContent = `# Enable Observability Hooks

Enable telemetry hooks for this project by restoring the hooks.json file.

Run this bash command:

\`\`\`bash
mv .cursor/hooks.json.disabled .cursor/hooks.json 2>/dev/null && echo "✓ Hooks enabled - telemetry active" || echo "Hooks already enabled or not found"
\`\`\`

Dashboard: http://localhost:${CLIENT_PORT}/observability
`;

  // Create /hooks-status command
  const hooksStatusContent = `# Check Hooks Status

Check if observability hooks are currently enabled or disabled.

Run this bash command:

\`\`\`bash
if [ -f .cursor/hooks.json ]; then
  echo "✓ Hooks ENABLED"
  echo "  Dashboard: http://localhost:${CLIENT_PORT}/observability"
elif [ -f .cursor/hooks.json.disabled ]; then
  echo "○ Hooks DISABLED"
  echo "  Run /hooks-on to enable"
else
  echo "✗ Hooks NOT CONFIGURED"
fi
\`\`\`
`;

  fs.writeFileSync(path.join(commandsDir, 'hooks-off.md'), hooksOffContent);
  fs.writeFileSync(path.join(commandsDir, 'hooks-on.md'), hooksOnContent);
  fs.writeFileSync(path.join(commandsDir, 'hooks-status.md'), hooksStatusContent);

  console.log('  Created commands: /hooks-on, /hooks-off, /hooks-status');
}


function setupGitignore() {
  const gitignorePath = path.join(TARGET_DIR, '.gitignore');
  const entry = '\n# Agent Observability traces\n.agent-runtime-observability/\n';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.agent-runtime-observability/')) {
      fs.appendFileSync(gitignorePath, entry);
      console.log('  Added .agent-runtime-observability/ to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, entry.trim() + '\n');
    console.log('  Created .gitignore with .agent-runtime-observability/');
  }
}

function makeHookExecutable() {
  try {
    fs.chmodSync(TELEMETRY_HOOK, '755');
  } catch {
    // Ignore chmod errors
  }
}

function setupAll() {
  console.log('\nConfiguring hooks...');

  setupCursorHooks();
  setupSlashCommands();
  setupGitignore();
  makeHookExecutable();

  console.log('');
}

// ============================================================================
// Commands
// ============================================================================

async function run() {
  console.log('Agent Observability\n');
  console.log(`Project: ${TARGET_DIR}\n`);

  // Check if hooks are already configured
  const cursorHooksPath = path.join(TARGET_DIR, '.cursor', 'hooks.json');
  const needsSetup = !fs.existsSync(cursorHooksPath) ||
    !fs.readFileSync(cursorHooksPath, 'utf8').includes('telemetry-hook');

  if (needsSetup) {
    setupAll();
  } else {
    console.log('Hooks already configured\n');
  }

  // Check if server is already running
  const serverRunning = await isPortInUse(SERVER_PORT);
  const clientRunning = await isPortInUse(CLIENT_PORT);

  if (serverRunning && clientRunning) {
    console.log('Server already running\n');
    console.log(`Opening http://localhost:${CLIENT_PORT}/observability\n`);
    openBrowser(`http://localhost:${CLIENT_PORT}/observability`);
    return;
  }

  // Start server
  await startServer();

  // Open browser
  console.log(`\nOpening http://localhost:${CLIENT_PORT}/observability\n`);
  setTimeout(() => openBrowser(`http://localhost:${CLIENT_PORT}/observability`), 2000);
}

function setup() {
  console.log('Agent Observability Setup\n');
  console.log(`Repo:    ${OBSERVABILITY_ROOT}`);
  console.log(`Target:  ${TARGET_DIR}\n`);

  setupAll();

  console.log('Setup complete!\n');
  console.log('To start the observability dashboard:\n');
  console.log(`  cd ${OBSERVABILITY_ROOT}`);
  console.log('  npm run dev\n');
  console.log(`Then open: http://localhost:${CLIENT_PORT}/observability\n`);
}

// ============================================================================
// CLI
// ============================================================================

const command = process.argv[2];

if (command === 'setup') {
  setup();
} else if (command === 'start') {
  run();
} else if (!command) {
  run();
} else {
  console.log('Agent Observability\n');
  console.log('Usage:');
  console.log('  agent-runtime-observability          - Setup hooks and start server');
  console.log('  agent-runtime-observability setup    - Only configure hooks');
  console.log('');
}
