#!/usr/bin/env node
/**
 * Agent Observability Setup Script
 *
 * Configures Cursor and Claude Code hooks for telemetry collection.
 * Run from a project directory: node /path/to/codemap/bin/setup.js setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEMAP_ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = process.cwd();
const SERVER_PORT = 5174;
const CLIENT_PORT = 5173;

// Hook path (absolute)
const TELEMETRY_HOOK = path.join(CODEMAP_ROOT, 'hooks', 'telemetry-hook.sh');

// ============================================================================
// Cursor Configuration
// ============================================================================

const cursorHooksConfig = {
  version: 1,
  hooks: {
    // Session lifecycle
    sessionStart: [{ command: `${TELEMETRY_HOOK} sessionStart` }],
    sessionEnd: [{ command: `${TELEMETRY_HOOK} sessionEnd` }],
    
    // Tool lifecycle (generic - fires for all tools)
    preToolUse: [{ command: `${TELEMETRY_HOOK} toolStart` }],
    postToolUse: [{ command: `${TELEMETRY_HOOK} toolEnd` }],
    postToolUseFailure: [{ command: `${TELEMETRY_HOOK} toolFailure` }],
    
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
// Claude Code Configuration
// ============================================================================

const claudeHooksConfig = {
  hooks: {
    PreToolUse: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: `${TELEMETRY_HOOK} toolStart` }]
      }
    ],
    PostToolUse: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: `${TELEMETRY_HOOK} toolEnd` }]
      }
    ],
    Stop: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: `${TELEMETRY_HOOK} stop` }]
      }
    ],
    Notification: [
      {
        matcher: ".*",
        hooks: [{ type: "command", command: `${TELEMETRY_HOOK} toolStart` }]
      }
    ]
  }
};

const claudePermissionsConfig = {
  permissions: {
    allow: [
      `Bash(${TELEMETRY_HOOK}:*)`
    ]
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
      cwd: CODEMAP_ROOT,
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

function setupClaudeHooks() {
  const claudeDir = path.join(TARGET_DIR, '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = path.join(claudeDir, 'settings.local.json');
  let settings = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Start fresh on parse error
    }
  }

  // Merge hooks
  settings.hooks = claudeHooksConfig.hooks;

  // Merge permissions
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];

  // Remove old codemap permissions
  settings.permissions.allow = settings.permissions.allow.filter(
    p => !p.includes('telemetry-hook') && !p.includes('file-activity-hook') && !p.includes('thinking-hook')
  );
  settings.permissions.allow.push(...claudePermissionsConfig.permissions.allow);

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('  Configured .claude/settings.local.json (Claude Code)');
}

function setupGitignore() {
  const gitignorePath = path.join(TARGET_DIR, '.gitignore');
  const entry = '\n# Agent Observability traces\n.codemap/\n';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.codemap/')) {
      fs.appendFileSync(gitignorePath, entry);
      console.log('  Added .codemap/ to .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, entry.trim() + '\n');
    console.log('  Created .gitignore with .codemap/');
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
  setupClaudeHooks();
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
  console.log(`Codemap: ${CODEMAP_ROOT}`);
  console.log(`Target:  ${TARGET_DIR}\n`);

  setupAll();

  console.log('Setup complete!\n');
  console.log('To start the observability dashboard:\n');
  console.log(`  cd ${CODEMAP_ROOT}`);
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
  console.log('  codemap          - Setup hooks and start server');
  console.log('  codemap setup    - Only configure hooks');
  console.log('');
}
