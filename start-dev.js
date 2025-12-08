#!/usr/bin/env node
const { spawn } = require('child_process');

console.log('[QuickFix] Starting backend and Expo servers...');

const backend = spawn('node', ['server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env }
});

const expo = spawn('npx', ['expo', 'start'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_PACKAGER_PROXY_URL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN
  }
});

backend.on('error', (err) => {
  console.error('[Backend] Error:', err);
});

expo.on('error', (err) => {
  console.error('[Expo] Error:', err);
});

process.on('SIGINT', () => {
  console.log('[QuickFix] Shutting down...');
  backend.kill();
  expo.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[QuickFix] Terminating...');
  backend.kill();
  expo.kill();
  process.exit(0);
});
