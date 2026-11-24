# Rented machines for workers

Use this when the user asks for a cloud machine that workers need, such as hardware the home machine does not have. Rented machines cost money by the hour and capacity can be scarce, so the coordinator runs them, not the workers.

## Rules

- Create exactly one machine, and only for the job the user asked for. Another machine needs a new user message. Write the request and its scope into the schedule prompt with the date.
- Only the coordinator creates, uses and deletes it. Tell workers: "I run the machine and send you the logs; do not create, use or delete one yourself." Treat a worker that touches a machine as breaking a rule.
- Use one machine name per effort, and check every provider's list on every check-in (for example `doctl compute droplet list` and `runpodctl pod list --all`), whether or not a poller is running. Look for any machine you created, not only ones with the current name.
- Delete the machine only after every log and output file is copied to the home machine and you have checked them there (files present, sizes non-zero, done markers present, the expected number of result lines). Then delete it at once and confirm that every provider's list is empty. Deleting while a job is running loses the job; this happened twice.
- Never leave a machine idle. On each check-in, if a machine exists and no job is running on it, finish the copy and delete it.
- Before the full job, check the machine with one short job (devices visible, one short run of the real command), because a provider's image may differ from what you tested.

## Waiting for capacity

`scripts/gpu-machine-poller.sh` polls RunPod and DigitalOcean until one has GPU capacity, creates exactly one machine, and exits. It is a template: read its header (`--help`) for the settings, and adapt the create commands for other providers or machine types. Run it in the background with its log, and monitor the log from its first line for `GRAB`, which matches every line it exits with, with `timeout_ms` above `GRAB_MAX_SECONDS`. The poller continues only after a provider refuses a create for lack of capacity; any other failed create stops it with `GRAB_UNKNOWN`. When you adapt it to another provider, set the refusal pattern from that provider's real capacity-refusal message.

- `GRABBED`: set the machine up and run the job.
- `GRAB_UNKNOWN`: a create may have made a machine the poller could not confirm. List both providers yourself before anything else, and do not restart the poller while a machine may exist.
- `GRAB_ABORT`: a machine with that name exists, or another poller is running. Find out which.
- `GRAB_TIMEOUT`: tell the user, and do not restart it without a new message.
- `GRAB_CONFIG_ERROR`: fix the setting it names.

Build what the remote machine runs on the home machine from the exact commits involved, record checksums, and have the remote job print them so the logs prove what ran. Put the copied logs under the worker's worktree (for example `<worktree>/.amp/in/logs/<provider>-<id>/`) and send the worker their paths.
