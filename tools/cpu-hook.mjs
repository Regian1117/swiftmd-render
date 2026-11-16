// Preloaded by tools/bench.mjs (node --import): reports this process's CPU time (all threads) at exit.
process.on('exit', () => {
  const u = process.cpuUsage();
  process.stderr.write(`cpu ${((u.user + u.system) / 1000).toFixed(1)}ms\n`);
});
