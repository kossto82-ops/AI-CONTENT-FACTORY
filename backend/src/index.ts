import { getDB } from './db/database.js';
import { startServer } from './server.js';

// Entry point for the AI Content Factory backend (API + orchestration).
// Ensure the store is open/migrated, then serve the Control Center API.
getDB();
startServer();
