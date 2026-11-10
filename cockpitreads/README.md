# cockpitreads.com

Website for **Cockpit Reads**, the YouTube channel by Dexter Dow.

One self-contained page: `index.html` (HTML, CSS, and JS inline; fonts from Google Fonts). No build step.

## Before going live

Edit the `SITE` block near the bottom of `index.html`:

| Key | What to put there |
| --- | --- |
| `youtubeUrl` | Channel link. Set to `https://www.youtube.com/@cockpitreads`. |
| `channelId` | `UCBFgIZl6q_sewKY87g_JA9g`. Drives the embedded latest-uploads player. Empty shows a "Go to the channel" card instead. |
| `gsrUrl` | Granite State Report link. |
| `email` | Contact inbox. |

## Hosting (free)

- **GitHub Pages:** put `index.html` and `CNAME` at the root of their own repo (for example `cockpitreads-site`), then Settings > Pages > Deploy from branch.
- **Cloudflare Pages or Netlify:** drag this folder into a new project.

Then point the `cockpitreads.com` DNS at the host, following the host's custom-domain instructions. `CNAME` already contains `cockpitreads.com` for GitHub Pages.
