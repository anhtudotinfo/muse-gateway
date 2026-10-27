// Test harness: fakes a TTY stdin so the interactive menu renders, then
// drives keypress events programmatically (down x N -> Enter on Exit).
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
process.stdin.setRawMode = function () { return this; };
process.stdin.resume();

const bin = process.argv[2] || require('path').join(__dirname, 'bin', 'muse-gateway.cjs');
const steps = (process.argv[3] || 'down,down,down,down,down,enter').split(',');
require(bin);

let delay = 1800;
for (const s of steps) {
  const name = s === 'enter' ? 'return' : s;
  setTimeout(() => process.stdin.emit('keypress', '', { name, ctrl: false, shift: false, sequence: '' }), delay);
  delay += 400;
}
setTimeout(() => { console.log('\n[harness] timeout — force exit'); process.exit(2); }, delay + 8000);
