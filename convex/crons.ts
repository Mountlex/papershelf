import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run daily at 3:00 AM UTC to clean up expired sessions and tokens
crons.daily(
  "cleanup-expired-sessions",
  { hourUTC: 3, minuteUTC: 0 },
  internal.sessionCleanup.cleanupExpiredSessions
);

// Run background refresh every 5 minutes
crons.interval(
  "background-repository-refresh",
  { minutes: 5 },
  internal.sync.backgroundRefreshTick
);

export default crons;
