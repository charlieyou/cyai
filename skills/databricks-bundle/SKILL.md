---
name: databricks-bundle
description: |
  Manage Databricks Asset Bundles (DABs) for infrastructure as code. Use when user wants to:
  (1) Initialize a new bundle project from templates
  (2) Deploy jobs, pipelines, or apps to workspaces
  (3) Run jobs/pipelines from bundle definitions
  (4) Generate bundle config from existing resources
  (5) Manage multi-environment deployments (dev/staging/prod)
  Triggers: "bundle", "DAB", "deploy to databricks", "init project", "databricks.yml"
---

# Databricks Asset Bundles CLI

Use `databricks bundle <command> --help` for detailed flags.

## Workflow

```bash
databricks bundle init default-python   # 1. Create project
databricks bundle validate              # 2. Check config
databricks bundle deploy --target dev   # 3. Deploy
databricks bundle run my_job            # 4. Run
```

## Init

```bash
databricks bundle init                    # Interactive
databricks bundle init default-python     # Python notebooks + jobs
databricks bundle init default-sql        # SQL files
databricks bundle init dbt-sql            # dbt project
databricks bundle init mlops-stacks       # MLOps pipeline
databricks bundle init <git-url>          # Custom template
```

## Validate & Deploy

```bash
databricks bundle validate
databricks bundle validate --target prod

databricks bundle deploy
databricks bundle deploy --target prod
databricks bundle deploy --auto-approve          # CI/CD (no prompts)
databricks bundle deploy --var="env=prod"
databricks bundle deploy --fail-on-active-runs
```

## Run

```bash
databricks bundle run my_job
databricks bundle run my_job --params="date=2024-01-01"
databricks bundle run my_job --only="task1,task2"
databricks bundle run my_job --no-wait
databricks bundle run my_pipeline --full-refresh-all
databricks bundle run my_pipeline --refresh="table1,table2"

# Pass args to Python tasks
databricks bundle run my_job -- arg1 arg2
databricks bundle run my_job -- --key value
```

## Generate from Existing

```bash
databricks bundle generate job --existing-job-id 123 --key my_job
databricks bundle generate pipeline --existing-pipeline-id abc --key my_pipe
databricks bundle generate job --existing-job-id 123 --key my_job --bind  # auto-bind
```

## Bindings

```bash
databricks bundle deployment bind my_job 123      # Link to existing
databricks bundle deployment unbind my_job        # Unlink
```

## Other

```bash
databricks bundle summary                  # List deployed resources
databricks bundle destroy --auto-approve   # Remove all resources
databricks bundle sync                     # Dev: sync files to workspace
```

## References

- [databricks.yml](references/databricks.yml) - Annotated config with jobs, pipelines, variables, targets
- [ci-cd.md](references/ci-cd.md) - GitHub Actions and Azure DevOps examples
