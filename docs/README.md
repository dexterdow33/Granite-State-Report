# DexterDow.com

Static author site. No build step. Served by GitHub Pages from this `docs/` folder.

- `index.html`: page, styles, and the script that renders the book grid.
- `books.js`: the catalog. Edit this to add a book, fix a title, or publish a held one (`live: true`).
- `CNAME`: tells GitHub Pages to answer on `dexterdow.com`.

## Going live

1. Repo **Settings > Pages**: Source = "Deploy from a branch", branch = `master`, folder = `/docs`. Custom domain = `dexterdow.com`. Tick "Enforce HTTPS" once the certificate issues.
2. At the domain's DNS host, point the apex at GitHub Pages:
   - `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `CNAME` for `www`: `dexterdow33.github.io`
3. DNS can take up to a day to spread.

GitHub Pages on a private repository needs a paid GitHub plan. On a free account the repository must be public.

## Preview locally

Open `index.html` in a browser, or run `python3 -m http.server` in this folder and visit http://localhost:8000.
