# Push worker deployment runbook

The tracked worker scripts are deployment templates. Install them explicitly as
root-owned executables; do not copy their Git file mode blindly from a Windows
checkout.

```sh
install -o root -g root -m 0700 scripts/push-worker-tick.sh /root/push-worker-tick.sh
install -o root -g root -m 0700 scripts/push-worker-burst.sh /root/push-worker-burst.sh
bash -n /root/push-worker-tick.sh /root/push-worker-burst.sh
```

Keep the environment outside the repository at
`/root/.config/monitorapp/push-worker.env`, owned by `root:root` with mode
`0600`. Both scripts fail closed when this invariant, the key format, the URL,
or the batch limit is invalid. Plain HTTP is permitted only for loopback;
remote worker endpoints must use HTTPS. The key is passed to curl through
standard input, so it is not exposed in the process command line.

## Atomic key rotation

1. Back up the current runtime configuration, database trigger configuration,
   root-only worker environment, and deployed worker scripts without printing
   the key.
2. Generate one URL-safe 32-128 character key under `umask 077`. Never put it
   in Git, a command argument, shell history, CI output, or an application log.
3. Stage the same value in the Edge runtime secret, the database trigger
   request header, and a new root-owned `0600` worker environment file.
4. Activate all three values in one maintenance window, atomically rename the
   staged environment file, restart the Edge runtime, and wait for its HTTP
   readiness probe before testing.
5. Verify that a missing key and an invalid key both return `401`; then run one
   valid worker canary and confirm `ok: true`. Confirm the immediate database
   trigger path and the bounded periodic fallback independently.
6. Retain the previous configuration until delivery and queue metrics remain
   healthy. On any failed canary, restore every backed-up store together and
   rerun the negative and valid-key checks.

The fallback scheduler must invoke `/root/push-worker-burst.sh`; preserve the
existing production cadence and ensure only one timer/cron entry is active.
Monitor `monitorapp-push-worker` journal events and `/var/log/push-worker.log`
without logging request headers.
