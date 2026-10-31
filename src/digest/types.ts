// The morning digest: one row per job for one night of runs/<night>.jsonl (plan.md § 1).
// Section 2 (page, JSON, board link, route tests) builds against this file only.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string; // ISO 8601 with the log's own offset; never converted to UTC
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export type DigestRow = {
  job: string;
  owner: string | null; // last owner seen for the job; views show null as '—'
  runs: number; // lines for this job, every status
  retries: number; // lines with status 'retry'
  lastStatus: RunStatus;
  lastError: string | null; // most recent `error` seen for the job, even if a later run was ok
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse; counted, never thrown
};

// null: no file for that night (or `night` is not YYYY-MM-DD) -> routes answer 404.
// An empty file is a Night with no rows -> "nothing ran".
export type ReadNight = (runsDir: string, night: string) => Night | null;

// Marking on the page: retries of 3 or more, and any fail.
export const RETRY_WARN_AT = 3;
