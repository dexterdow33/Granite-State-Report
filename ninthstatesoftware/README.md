# NinthStateSoftware.com

Static storefront for Ninth State Software. Plain HTML, CSS, and JavaScript. No build step, no paid services required.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: hero, catalog, build process, custom work, FAQ, sign-up |
| `site.js` | **Edit this.** Contact email, sign-up form endpoint, and the product catalog |
| `styles.css` | Look and feel (light and dark themes) |
| `favicon.svg` | Browser-tab icon |
| `CNAME` | Tells GitHub Pages to serve the site at `ninthstatesoftware.com` |

## Add an app

Open `site.js`, find `PRODUCTS`, and add an entry:

```js
{
  name: "App Name",
  category: "Productivity",
  price: "$19",
  summary: "What it does and who it's for, in one or two sentences.",
  platform: "Windows · macOS",
  version: "1.0",
  buyUrl: "https://buy.stripe.com/your-link",
}
```

`buyUrl` is any hosted checkout link: Stripe Payment Links, Gumroad, or Lemon Squeezy. Fees differ and change, so check each one's current pricing page before you pick. When `PRODUCTS` is empty the page shows a stamped "Sample listing" card so the layout is visible.

## Publish for free

**GitHub Pages:** put these files at the root of their own repo (for example `ninthstatesoftware-site`), then Settings → Pages → Deploy from branch `main`, folder `/`. The `CNAME` file sets the custom domain.

**Cloudflare Pages or Netlify:** connect the repo, leave the build command blank, and set the output directory to this folder.

Then point the domain's DNS at the host, following that host's custom-domain instructions.

## Before launch

- [ ] Register or confirm ownership of `ninthstatesoftware.com`.
- [ ] Set `SITE.contactEmail` in `site.js` to a mailbox you have tested.
- [ ] Set `SITE.notifyEndpoint` to a free form or newsletter service, or leave blank (the form then points people to the email).
- [ ] Add at least one real app to `PRODUCTS`.
- [ ] Write Terms, Privacy, and Refund pages and link them in the footer. Have someone qualified review them; selling software creates obligations this page does not cover.
- [ ] Read every promise in the copy and keep only the ones you will keep: hand-testing each release, "one email per release," refund terms at checkout, no tracking cookies (stays true only if you add no analytics).
