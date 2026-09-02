import { getDB } from './db/database.js';
import { jobRepo } from './db/repository.js';
import { startServer } from './server.js';

// Entry point for the AI Content Factory backend (API + orchestration).
// Ensure the store is open/migrated, recover any jobs left RUNNING by a
// previous (killed) process, then serve the Control Center API.
getDB();
const recovered = jobRepo.recoverInterrupted();
if (recovered > 0) {
  // eslint-disable-next-line no-console
  console.log(`[aicf] recovered ${recovered} interrupted RUNNING job(s) -> READY`);
}
startServer();
