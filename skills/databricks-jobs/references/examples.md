# Job Configuration Examples

## Notebook Task

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

## Python Script Task

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

## Multi-Task DAG

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

## With Schedule

```json
{
  "name": "scheduled-job",
  "tasks": [...],
  "schedule": {
    "quartz_cron_expression": "0 0 9 * * ?",
    "timezone_id": "America/New_York",
    "pause_status": "UNPAUSED"
  }
}
```

## Cron Patterns (Quartz)

| Pattern | Meaning |
|---------|---------|
| `0 0 9 * * ?` | Daily at 9am |
| `0 0 * * * ?` | Hourly |
| `0 */15 * * * ?` | Every 15 min |
| `0 0 8 ? * MON-FRI` | Weekdays at 8am |
| `0 0 0 1 * ?` | Monthly (1st at midnight) |

## With Job Cluster (ephemeral)

```json
{
  "name": "job-with-cluster",
  "tasks": [{
    "task_key": "main",
    "notebook_task": {"notebook_path": "/Workspace/notebook"},
    "new_cluster": {
      "spark_version": "13.3.x-scala2.12",
      "node_type_id": "i3.xlarge",
      "num_workers": 2
    }
  }]
}
```
