#!/usr/bin/env node
/**
 * Inicia o binário do Electron sem ELECTRON_RUN_AS_NODE.
 * Quando RUN_AS_NODE=1 (ex.: alguns ambientes de IDE), require('electron') no
 * main não expõe app/BrowserWindow — o processo precisa ser o app Electron real.
 */
const { spawn } = require('child_process')
const path = require('path')

const electronExe = require('electron')
const root = path.join(__dirname, '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electronExe, ['.'], {
  cwd: root,
  env,
  stdio: 'inherit',
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
