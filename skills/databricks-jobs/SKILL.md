---
name: databricks-jobs
description: |
  Manage Databricks Jobs via CLI. Use when user wants to:
  (1) Create, update, or delete job definitions
  (2) Run jobs or submit one-time runs
  (3) List jobs or get job details
  (4) Monitor runs, check status, or cancel
  Triggers: "databricks job", "create job", "run job", "job status", "list jobs", "cancel run"
---

# Databricks Jobs CLI

Use `databricks jobs --help` for detailed flags.

## List & Get

```bash
databricks jobs list
databricks jobs list --output json
databricks jobs get <job-id>
databricks jobs list --output json | jq '.jobs[] | select(.settings.name == "name")'
```

## Create & Update

```bash
databricks jobs create --json @job.json
databricks jobs create --json '{"name": "x", "tasks": [...]}'
databricks jobs update <job-id> --json '{"name": "new-name"}'
databricks jobs reset --json '{"job_id": 123, "new_settings": {...}}'  # full replace
databricks jobs delete <job-id>
```

## Run

```bash
databricks jobs run-now <job-id>
databricks jobs run-now <job-id> --json '{"notebook_params": {"p1": "v1"}}'
databricks jobs submit --json @run-config.json   # one-time run
```

## Monitor

```bash
databricks jobs list-runs --job-id <job-id>
databricks jobs get-run <run-id>
databricks jobs get-run-output <run-id>
databricks jobs cancel-run <run-id>
```

## Export/Import

```bash
databricks jobs get <job-id> --output json > backup.json
databricks jobs create --json @backup.json
```

## References

- [examples.md](references/examples.md) - Job JSON configs: notebook, python, multi-task DAG, schedules, cron patterns
