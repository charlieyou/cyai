---
name: databricks-jobs
description: |
  Manage Databricks Jobs using the Databricks CLI. Use when the user wants to:
  (1) Create, update, or delete job definitions
  (2) Run jobs or submit one-time runs
  (3) List jobs or get job details
  (4) Monitor job runs, check status, or cancel runs
  (5) Export or import job configurations
  Triggers: "databricks job", "create job", "run job", "job status", "list jobs", "cancel run"
---

# Databricks Jobs CLI

Manage Databricks workflow jobs via `databricks jobs` commands.

## Common Operations

### List Jobs

```bash
# List all jobs
databricks jobs list

# List with output format
databricks jobs list --output json
```

### Get Job Details

```bash
# Get job by ID
databricks jobs get <job-id>

# Get job by name (use jq to filter)
databricks jobs list --output json | jq '.jobs[] | select(.settings.name == "job-name")'
```

### Create Job

```bash
# Create from JSON file
databricks jobs create --json @job-config.json

# Create inline (notebook task example)
databricks jobs create --json '{
  "name": "my-job",
  "tasks": [{
    "task_key": "main",
    "notebook_task": {
      "notebook_path": "/Workspace/path/to/notebook"
    },
    "existing_cluster_id": "<cluster-id>"
  }]
}'
```

### Update Job

```bash
# Full replacement (job_id must be in JSON)
databricks jobs reset --json '{"job_id": 123, "new_settings": {...}}'

# Partial update
databricks jobs update <job-id> --json '{"name": "new-name"}'
```

### Delete Job

```bash
databricks jobs delete <job-id>
```

### Run Job

```bash
# Trigger a run
databricks jobs run-now <job-id>

# Run with parameters
databricks jobs run-now <job-id> --json '{"notebook_params": {"param1": "value1"}}'

# Submit one-time run (no saved job)
databricks jobs submit --json @run-config.json
```

### Monitor Runs

```bash
# List runs for a job
databricks jobs list-runs --job-id <job-id>

# Get specific run details
databricks jobs get-run <run-id>

# Get run output
databricks jobs get-run-output <run-id>

# Cancel a run
databricks jobs cancel-run <run-id>
```

### Export/Import Jobs

```bash
# Export job config
databricks jobs get <job-id> --output json > job-backup.json

# Import (create from exported config)
databricks jobs create --json @job-backup.json
```

## Job Configuration Patterns

### Notebook Task

```json
{
  "name": "notebook-job",
  "tasks": [{
    "task_key": "run_notebook",
    "notebook_task": {
      "notebook_path": "/Workspace/folder/notebook",
      "base_parameters": {"env": "prod"}
    },
    "existing_cluster_id": "<cluster-id>"
  }]
}
```

### Python Script Task

```json
{
  "name": "python-job",
  "tasks": [{
    "task_key": "run_script",
    "spark_python_task": {
      "python_file": "dbfs:/path/to/script.py",
      "parameters": ["arg1", "arg2"]
    },
    "existing_cluster_id": "<cluster-id>"
  }]
}
```

### Multi-Task Workflow

```json
{
  "name": "multi-task-job",
  "tasks": [
    {
      "task_key": "extract",
      "notebook_task": {"notebook_path": "/Workspace/etl/extract"},
      "existing_cluster_id": "<cluster-id>"
    },
    {
      "task_key": "transform",
      "depends_on": [{"task_key": "extract"}],
      "notebook_task": {"notebook_path": "/Workspace/etl/transform"},
      "existing_cluster_id": "<cluster-id>"
    },
    {
      "task_key": "load",
      "depends_on": [{"task_key": "transform"}],
      "notebook_task": {"notebook_path": "/Workspace/etl/load"},
      "existing_cluster_id": "<cluster-id>"
    }
  ]
}
```

### Schedule Configuration

Add to job config:
```json
{
  "schedule": {
    "quartz_cron_expression": "0 0 9 * * ?",
    "timezone_id": "America/New_York",
    "pause_status": "UNPAUSED"
  }
}
```

Common cron patterns:
- Daily at 9am: `0 0 9 * * ?`
- Hourly: `0 0 * * * ?`
- Every 15 min: `0 */15 * * * ?`
- Weekdays at 8am: `0 0 8 ? * MON-FRI`

## Tips

- Use `--output json` for scriptable output
- Pipe to `jq` for filtering: `databricks jobs list --output json | jq '.jobs[] | {id: .job_id, name: .settings.name}'`
- Check run logs: `databricks jobs get-run-output <run-id> | jq '.notebook_output'`
