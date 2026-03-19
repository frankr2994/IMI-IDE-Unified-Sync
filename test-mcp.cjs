const { spawn } = require('child_process');
const path = require('path');

const cp = spawn('npx.cmd', ['-y', '@amitdeshmukh/google-jules-mcp'], {
  env: { ...process.env, JULES_API_KEY: process.env.JULES_API_KEY },
  shell: true
});

cp.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      console.log('RECV:', JSON.stringify(msg, null, 2));
    } catch(e) {
      console.log('RAW:', line);
    }
  }
});

const send = (msg) => {
  console.log('SEND:', JSON.stringify(msg));
  cp.stdin.write(JSON.stringify(msg) + '\n');
};

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' }
  }
});

setTimeout(() => {
  send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {}
  });
  
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
}, 2000);

setTimeout(() => {
  cp.kill();
}, 5000);
