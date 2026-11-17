// Compatibility shim — the entry point is src/index.js (app assembly in
// src/app.js, /api mounts in src/routes/api.js). Kept so `node server.js`
// still works for anyone with the old command in their notes.
require('./src/index');
