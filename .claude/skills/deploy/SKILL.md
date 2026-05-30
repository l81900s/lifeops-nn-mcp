---
name: deploy
description: Deploy the latest branch to [DEV_HOSTNAME] and run the full validation suite (smoke test + DB check + report)
allowed-tools: Bash, Read
---

# /deploy — Deploy and validate [ENV_NAME]

> **TEMPLATE NOTICE:** This skill is a redacted starting point modeled on a working deploy skill. Replace every `[BRACKETED_PLACEHOLDER]` with your project's actual values, then delete this notice. If your stack diverges (no SSM, no SSH, deploys via CI, container-based, etc.), restructure the steps to match.

Automates the full deploy-and-validate cycle for the dev server.

## Prerequisites (operator must complete before invoking)

The SSH key must be in place:
```bash
# Paste private key from [SECRETS_LOCATION, e.g., 1Password under Org > AWS > dev section]
chmod 500 /tmp/[KEY_FILENAME]
```
The key does **not** survive reboots. If SSH fails with a permissions or key error, this is why.

## What this skill does

Runs all steps in order. If any step fails, report it clearly and continue to the next step rather than aborting — the final report should capture all failures, not just the first one.

> If your dev server has any quirks (missing tools, special venv setup, etc.), document them here so future Claude Code sessions know not to retry the same mistake.

---

## Step 0 — Confirm SSH key is present

```bash
ls -la /tmp/[KEY_FILENAME]
```

If the file is missing or permissions are wrong (must be 400 or 500), **stop and tell the user** to place the key before proceeding.

---

## Step 1 — Check instance state

```bash
AWS_PROFILE=[CLI_PROFILE] aws ec2 describe-instances \
  --instance-ids [INSTANCE_ID] \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text \
  --region [AWS_REGION]
```

If not `running`, tell the user and stop.

---

## Step 2 — Deploy

SSH into `[DEV_HOSTNAME]` at `[DEV_PUBLIC_IP]` (ubuntu user, key at `/tmp/[KEY_FILENAME]`).

Run each command via SSH. Use `-o StrictHostKeyChecking=no` to avoid interactive host key prompts.

### 2a. Git pull

```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "cd /home/ubuntu/[REPO_DIR] && git pull 2>&1"
```

Capture the output. If `Already up to date.`, note that no new code was pulled but continue the deploy anyway (the user may want to re-run a migration or restart the service).

### 2b. Check for `[breaks:]` tags in new commits

After `git pull`, identify any new commits since the previous HEAD and check their subjects for `[breaks: ...]` tags. Report which break items are required. Then apply them:

**If `[breaks: requirements]`:**
```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "cd /home/ubuntu/[REPO_DIR] && source [VENV_DIR]/bin/activate && pip install -r requirements.txt 2>&1"
```

**If `[breaks: db]`:**

> ⚠️ **Destructive operation** — confirm with the user before running.

```bash
# [Replace with your actual migration command. Example:]
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "cd /home/ubuntu/[REPO_DIR] && [DEV_ENV]=production source [VENV_DIR]/bin/activate && python [CLI_SCRIPT] [MIGRATE_COMMAND] 2>&1"
```

**If `[breaks: unit-file]`:**
```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "sudo cp /home/ubuntu/[REPO_DIR]/[SERVICE_FILE] /etc/systemd/system/[SERVICE_FILE] && sudo systemctl daemon-reload 2>&1"
```

### 2c. Restart the service

```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "sudo systemctl restart [SERVICE_NAME] && sleep 3 && sudo systemctl status [SERVICE_NAME] --no-pager 2>&1"
```

Check that the service is `active (running)`. If not, show the last 30 lines of journal output and mark the deploy as failed:
```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "journalctl -u [SERVICE_NAME] -n 30 --no-pager 2>&1"
```

---

## Step 3 — Smoke test

```bash
# [Replace with your actual smoke-test invocation.]
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "cd /home/ubuntu/[REPO_DIR] && source [VENV_DIR]/bin/activate && \
   [DEV_ENV]=production python [SMOKE_TEST_PATH] \
     --base-url http://localhost:[APP_PORT] 2>&1"
```

Capture the full output. Parse the `Results: N/N passed` line (or whatever your test runner emits). If any FAILs appear, list them.

---

## Step 4 — Database / data validation (optional)

If you have a database, do a row-count or FK-integrity spot-check against expected tables. Example:

```bash
ssh -i /tmp/[KEY_FILENAME] -o StrictHostKeyChecking=no ubuntu@[DEV_PUBLIC_IP] \
  "PGPASSWORD=\$(AWS_PROFILE=[CLI_PROFILE] aws ssm get-parameter \
      --name [SSM_PASSWORD_PATH] --with-decryption \
      --query Parameter.Value --output text --region [AWS_REGION]) \
   psql -h [DB_PRIVATE_IP] -U postgres [DB_NAME] -c \
   \"SELECT COUNT(*) FROM [TABLE];\" 2>&1"
```

---

## Step 5 — Test report

Produce a final go/no-go checklist in this format:

```
=== Deploy Report: [ENV_NAME] | <branch> @ <commit-sha> | <timestamp> ===

DEPLOY
  [PASS/FAIL] Service restarted and running
  [PASS/FAIL] Service status: active (running)
  [INFO]      Commits pulled: N (or "Already up to date")
  [INFO]      Breaks applied: <list or "none">

SMOKE TEST
  [PASS/FAIL] N/N checks passed
  [FAIL]      <list any failed check names>

DATA VALIDATION
  [PASS/WARN] <row-count or FK-check result>

OVERALL: GO / NO-GO
```

If any step is NO-GO, list the failures clearly and suggest next steps.
