# Closed Loop Research Control Room — independent public dashboard

A fully separate frontend for your existing Closed Loop research. Source for the public dashboard repository: `zachfeemster-create/closed-loop-research-dashboard`. GitHub Pages becomes available after Pages is enabled and its deployment workflow succeeds.

**Upstream source remains untouched:** `https://github.com/zachfeemster-create/Closed-loop`

## What works once published

- **Nightly archives:** on load and Refresh, fetch every canonical `autorun/results/nightly/YYYY-MM-DD.json` from the upstream public repo. Compare any two runs with stable `(series name, lens, EQ)` survivor keys; inspect all lens checks, fake-arm flags and Max notes. PR #15/#16/#17 status also refreshes from GitHub.
- **Interactive runs from the Streamlit site:** the existing app logs Lens rotation, Run a Test, fingerprint and game results to `zachfeemster-create/closed-loop-log` when its private GitHub logging is configured. This dashboard uses a scheduled GitHub Action to publish a **redacted index** to its own `data/run_index.json`. Refresh then loads any newly indexed interactive runs.
- **Immediately inspect a private run:** enter a fine-grained, read-only token in the dashboard's Live Sources tab. The token stays in page memory; the full record can be read as soon as the upstream app saves it. Otherwise, the public index sync has a schedule and is not instantaneous.
- **Your research workspace:** edit hypotheses, regression notes, tests, evidence, next actions, and export/import JSON. Research edits stay in that browser's local storage until exported; they are not automatically committed to GitHub.

## Deployment — create the separate repository

1. Create **public** repo `closed-loop-research-dashboard` at https://github.com/new?name=closed-loop-research-dashboard&visibility=public . Leave the existing repos alone. Make sure its default branch is `main` (if using the web UI, initialize with README if you intend to upload through the GitHub connector afterward).
2. Commit this package's files to that new repository's `main` branch. Include the hidden `.github/workflows/` directory. You can do this by uploading via GitHub's web interface or using `git add -A && git commit && git push` locally.
3. In the **new dashboard repo only**, go to **Settings → Pages → Build and deployment** and select **GitHub Actions**. The `pages.yml` workflow deploys the static site on pushes to `main`. Live URL: `https://zachfeemster-create.github.io/closed-loop-research-dashboard/` once deployed successfully. URL is not active until Pages is configured and deployment succeeds.
4. To show Streamlit interactive-run summaries without asking for a token every time, create a fine-grained GitHub personal access token that has **Contents: Read-only** access **only to the existing private `closed-loop-log` repo**. In the *new public dashboard repo*, add it at **Settings → Secrets and variables → Actions → New repository secret** named `CLOSED_LOOP_LOG_TOKEN`. Never put the token into any committed file or issue.
5. In the new repo, open **Actions → Sync Closed Loop run summaries → Run workflow** for the first index population. Subsequent GitHub Actions schedules run about every 10 minutes (GitHub may delay schedules). The dashboard's **Refresh** then reads the updated index. A run logged in the private repo isn't visible in the token-free public digest until the sync completes. For immediate full results, connect the read-only token *inside your own current browser tab*.

### Verify the loop

1. Run a test in the original Streamlit app. Confirm it says **saved to the shared log ✓** and provides a new distinct run ID. If there is no confirmation, the app may retain the result only locally, where another site's browser cannot access it.
2. Wait for the next successful dashboard **Sync Closed Loop run summaries** Action, or trigger it manually.
3. Open the published dashboard and press **Refresh**. The new run ID should appear in **Live sources → Interactive run history**. Scheduled nightly jobs are separate: once the original main repo commits a new nightly JSON, a Refresh immediately sees it.
4. Check the source SHA and source URL on nightly runs. Do not confuse nightly fake percentiles with the Kaggle quantum submission's score.

## What exactly goes public?

**The dashboard repo is public.** The sync Action publishes *redacted metadata and numeric test statistics* (run IDs, family, timestamps, pass/fail, counts, selected numeric checks, Git blob SHA) under `data/run_index.json`. It deliberately **omits private raw input, raw CSV, plans, keystones, user questions, full notes, and GitHub credentials**. Review `scripts/sync_private_log.py` before enabling if you don't want even those summaries public. The private original run files remain in `closed-loop-log`.

The private run log access token used by the browser's optional authentication is **never** committed, saved in localStorage, or exported in the browser research database.

## Repository workflows

- `.github/workflows/pages.yml` deploys the dashboard after the new repository is configured for GitHub Pages.
- `.github/workflows/sync-private-log.yml` polls the private repo using a read-only secret, runs redaction tests, and commits the redacted index. It does not write to either original repo.
- `scripts/sync_private_log.py` is the public-index generator. It caches unchanged Git blob SHAs to avoid refetching all runs each time.
- `scripts/test_sync.py` validates secret redaction, caching and the truncated-tree guard.

## Known limitations

GitHub's repository-creation and Pages-configuration operations are **not available through the currently connected GitHub chat actions**, so these steps require your account's GitHub UI. Schedules are not realtime webhooks: token-free interactive summaries appear only after the Action runs and commits. No syncing can recover runs never saved to `closed-loop-log`; a Streamlit run that exists only in someone else's browser cannot be pulled into this dashboard.

The dashboard is separate from the original Closed Loop repository and from the Kaggle quantum compilation entry. Research notes and private interactive original records require provenance before being treated as verified evidence.