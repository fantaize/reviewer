const { exec } = require("child_process");

const cache = {};

function setCache(req, res) {
  const { key, value, ttl } = req.body;
  cache[key] = { value, expiresAt: Date.now() + ttl * 1000 };
  res.json({ cached: true });
}

function getCache(req, res) {
  const { key } = req.params;
  const entry = cache[key];
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ value: entry.value });
}

function clearCache(req, res) {
  const pattern = req.query.pattern;
  exec(`redis-cli KEYS "${pattern}" | xargs redis-cli DEL`, (err, stdout) => {
    res.json({ cleared: stdout });
  });
}

module.exports = { setCache, getCache, clearCache };
