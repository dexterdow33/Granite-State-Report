# GSR Community

Granite State Report's members-only social platform for verified New Hampshire residents. Seven sections: Government, Marketplace, Discussion, Information, Help, Sharing, and News (one thread per GSR story). Nobody reads or posts until a moderator has checked their ID.

Status: working prototype (v0.2). Runs locally. Not ready for public launch until the checklist at the bottom is done.

## Run it

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).

```bash
cd gsr-community
npm install
npm start                                  # http://localhost:3000
```

Make yourself a moderator: sign up on the site, then

```bash
npm run make-admin -- you@example.com
```

Run the tests: `npm test`

Settings (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Database and private ID uploads |
| `SITE_NAME` / `SITE_DOMAIN` | `GSR Community` / `community.granitestatereport.com` | Branding |
| `BASE_URL` | `http://localhost:3000` | Public address, used in emailed links |
| `PARTNER_NAME` / `PARTNER_URL` | `Granite State Report` / `https://granitestatereport.com` | Newsroom whose stories get discussion threads |
| `SMTP_URL` | none | e.g. `smtps://user:pass@smtp.example.com:465`. Without it, emails print to the console |
| `MAIL_FROM` | `no-reply@community.granitestatereport.com` | Sender address |
| `NODE_ENV` | | `production` turns on secure cookies; run behind HTTPS |

## What it does

| Area | Details |
|---|---|
| Accounts | Email + password (scrypt hash), display name, town, county. 18+ and NH-residency attestation at signup. |
| Verification | Upload ID front, optional back, a selfie holding the ID, and a proof of NH address when the ID is a passport. A moderator reviews and approves or rejects. |
| Access | Logged-out visitors see only the landing page and policy pages. Unverified accounts see only the verification page. All content is members-only and marked `noindex`. |
| Posting | Posts in any of the six member sections (News threads are made only from GSR stories), tagged by county. Marketplace posts can carry a price. Comments, search, county filter, profiles with a "Verified NH" badge. |
| Moderation | Verification queue, report queue, remove posts, suspend and reinstate accounts. Members get an email when approved or rejected. |
| Accounts | Password reset by emailed one-hour link (signs out every other session). Members can edit their posts and delete their own account, which removes everything including any ID images still held. |
| GSR integration | Home feed shows the latest Granite State Report stories. Each story gets one discussion thread in the News section, opened from `/discuss?url=<story link>`. The app confirms the link is a published GSR post through WordPress's public REST API before making a thread, so nobody can create fake "GSR story" threads. |
| Security | CSRF tokens on every form, strict Content-Security-Policy with no scripts, HTML escaping everywhere, login rate limit, uploads checked by file signature (not just extension), ID files stored outside the web root and served only to admins with `no-store`. |

## How ID data is handled

- Uploads land in `data/private/verification/` under random names. The web server never serves that folder.
- Only admin accounts can open a file, and only while its review is pending.
- Approve or reject deletes every file for that submission before the response returns. The database keeps the document type, decision, reviewer, and date. No ID numbers, no birthdates, no images.
- Rejected or malformed uploads are deleted immediately.
- Submissions nobody reviews within 30 days expire: files deleted, member asked to resubmit.
- Deleting an account deletes any ID files still on disk.

## Connecting to Granite State Report

GSR runs on WordPress.com, which cannot run this Node app. The two stay separate programs joined by links:

1. **Host the app at `community.granitestatereport.com`.** Deploy it to any Node host with a persistent disk, then add a DNS record for the subdomain wherever granitestatereport.com's DNS is managed (WordPress.com, if the domain is registered there) pointing at that host. Set `BASE_URL` to `https://community.granitestatereport.com`.
2. **Install the plugin** in `integrations/wordpress/gsr-community-link/`. Zip that folder, upload it under Plugins > Add New > Upload, activate, and set the app address under Settings > GSR Community. Every GSR post then ends with a "Join the discussion" box that opens that story's thread.
3. **Add a menu link.** In the site editor's Navigation block (or Appearance > Menus), add a custom link to the community address labeled something like "Community".

Do steps 2 and 3 only after step 1 is live, or GSR readers get a dead link.

The story lookup expects GSR permalinks that end in the post slug (`/2026/09/28/story-slug/` or `/story-slug/`). A `?p=123` permalink setting would break it.

## Why a passport needs a second document

A U.S. passport proves identity and citizenship. It has no address on it, so on its own it cannot show someone lives in New Hampshire. The site requires a passport holder to add a dated proof of NH address.

The reverse is also true: an NH driver license or non-driver ID shows NH residency, not U.S. citizenship. The site verifies **residents**, which is what "NH only" can be checked against. If you want citizens only, that is a different and much harder document check.

## Before public launch

1. **Address.** The app lives at `community.granitestatereport.com`. `SITE_DOMAIN`, `MAIL_FROM`, and the plugin already default to it; set `BASE_URL=https://community.granitestatereport.com` on the server. The email provider must be allowed to send for that subdomain, or change `MAIL_FROM`.
2. **Hosting with HTTPS.** Any Node host with a persistent disk (a small VPS works). Set `NODE_ENV=production`. Back up `data/app.db`; never back up `data/private/`.
3. **Consider a verification vendor.** Manual review works for the first few hundred members. At scale, a vendor (Persona, Stripe Identity, ID.me, and others) does document authenticity and face match automatically, and you never hold the images. The verify route is the one place to swap.
4. **Lawyer review of privacy terms.** Collecting government ID is sensitive. Have an attorney check the privacy page against New Hampshire's data-breach notification law and the NH consumer privacy statute before launch (VERIFY current text and whether its size thresholds apply to you).
5. **Marketplace payments.** Listings only. No money moves through the site. Adding checkout means a payment processor and its compliance terms.
6. **Moderators.** Recruit at least two so the queue and reports do not depend on one person.
7. **Email.** Set `SMTP_URL` to a transactional email provider so reset links and approval notices go out.

## Not built yet

Direct messages, image uploads in posts, upvotes, town-level pages, notifications for replies, single sign-on with GSR (members keep separate logins).
