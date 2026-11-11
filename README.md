# Ownerloop status page

The page at **https://status.ownerloop.eu**: whether Ownerloop's QR codes, owner pages and brand dashboard are working, and their last 30 days.

How it works:

- **HetrixTools** checks each service every minute (the owner pages, the dashboard's login page, and the database through `/api/health`) and alerts the Ownerloop team by email and text message when one stops responding.
- **Every 5 minutes**, cron-job.org (account admin@ownerloop.eu) starts `.github/workflows/status.yml` through GitHub's API, with a GitHub key that can only start this project's workflows. GitHub's own timer runs it every 30 minutes as a backup (on its own it doesn't keep to 5 minutes). The workflow runs `build.mjs`: it reads HetrixTools' checks with a read-only key (the secret `HETRIXTOOLS_API_KEY`), writes one page into `site/` with `status.mjs`, and publishes it on GitHub Pages. If HetrixTools can't be reached, the last page stays up, and it warns visitors when it's more than 20 minutes old.
- **After every update**, a last step (`check-fresh.mjs`) opens the live page and fails if it is more than 30 minutes old, so GitHub emails admin@ownerloop.eu. The app also checks it every night and raises an error in Sentry when it is more than an hour old (in case the updates stop altogether).
- GitHub switches off timed runs in a public project after 60 days without changes, so `.github/workflows/keep-switched-on.yml` adds an empty change on the 1st and 15th of each month.

The page holds no personal data, sets no cookies and loads nothing from other sites. Its look follows the app's DESIGN.md (IBM Plex Sans, the app's colours and badges).

On a laptop:

```bash
node --test
node build.mjs --sample up
node preview.mjs
```

The samples are `up`, `down`, `maintenance` and `new`. The preview opens on http://localhost:4400.

The services and the HetrixTools checks behind them are listed at the top of `status.mjs`. A check renamed at HetrixTools shows as "Not checked" until its name is changed there too.

IBM Plex Sans: SIL Open Font License (`assets/IBM-Plex-Sans-LICENSE.txt`). Icons: Lucide (ISC licence).

## When the page stands still

GitHub emails that "Update the status page" failed at its check step, or Sentry reports that the status page has not updated. Look at GitHub: the project, then Actions. If the runs stopped, check cron-job.org's emails and that GitHub's timer is still on (the keep-switched-on run). If the runs go but the build step says HetrixTools could not be reached, check the HetrixTools key (see SETUP.md in the app). If the runs publish but the page stays old, look at GitHub, then Settings, then Pages.
