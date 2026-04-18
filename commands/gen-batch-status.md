---
description: Poll a batch job by ID, or list all jobs
argument-hint: [job-id | --list]
allowed-tools:
  - mcp__claude-image-tts-gen__batch_status
---

Check on a batch job: $ARGUMENTS

If the user passed a job ID, call `batch_status` with `jobId` to poll
it. The tool will silently advance the status (in_progress → completed)
and download outputs into the normal pipeline (file + sidecar + cache +
ledger entries marked as batch-priced).

If they passed `--list` or nothing, call `batch_status` with `list:true`
and show the table.

Currently implemented: google/image and openai/image batches. Other
combos return a clear "not yet implemented" note.
