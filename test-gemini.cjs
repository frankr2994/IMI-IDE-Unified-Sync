const { exec } = require('child_process');

exec('gemini -p "hello"', (err, out, stderr) => {
  console.log('--- STDOUT ---');
  console.log(out);
  console.log('--- STDERR ---');
  console.log(stderr);
  if (err) console.error('--- ERROR ---', err);
});
