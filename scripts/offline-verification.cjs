// Preload for verification only: fail closed before secrets or external I/O.
const fs = require('fs');
const secret = p => /(?:^|[\\/])\.env(?:\.|$)/i.test(String(p)) && !String(p).endsWith('.env.example');
for (const key of ['readFileSync', 'readFile']) {
  const original = fs[key];
  fs[key] = function (p, ...args) {
    if (secret(p)) throw new Error('Offline verification blocks secret-file reads');
    return original.call(this, p, ...args);
  };
}
const originalPromiseRead = fs.promises.readFile;
fs.promises.readFile = function (p, ...args) {
  if (secret(p)) return Promise.reject(new Error('Offline verification blocks secret-file reads'));
  return originalPromiseRead.call(this, p, ...args);
};
const blocked = () => { throw new Error('Offline verification blocks network/database access'); };
require('net').Socket.prototype.connect = blocked;
require('tls').connect = blocked;
global.fetch = blocked;
process.env.NEXT_TELEMETRY_DISABLED = '1';
// Bound build worker fan-out on the shared Windows machine.
const os = require('os');
const realCpus = os.cpus;
os.cpus = () => realCpus().slice(0, 2);
