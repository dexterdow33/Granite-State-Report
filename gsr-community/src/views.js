const { SECTIONS, COUNTIES, DOC_TYPES } = require('./config');

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const sectionName = (slug) => (SECTIONS.find((s) => s.slug === slug) || {}).name || slug;
const money = (cents) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);
const date = (s) => new Date(`${s}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const paragraphs = (text) => h(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const csrf = (req) => `<input type="hidden" name="_csrf" value="${h(req.csrfToken)}">`;

const countyOptions = (selected, blank) =>
  (blank ? `<option value="">${h(blank)}</option>` : '') +
  COUNTIES.map((c) => `<option ${c === selected ? 'selected' : ''}>${h(c)}</option>`).join('');

function layout(req, config, title, body, { flash } = {}) {
  const u = req.user;
  const member = u && (u.status === 'verified' || u.role === 'admin');
  const nav = member
    ? SECTIONS.map((s) => `<a href="/s/${s.slug}">${h(s.name)}</a>`).join('')
    : '';
  const account = u
    ? `${member ? `<a href="/u/${u.id}">${h(u.display_name)}</a>` : ''}
       <a href="/account">Account</a>
       ${u.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
       <form method="post" action="/logout" class="inline">${csrf(req)}<button class="linklike">Log out</button></form>`
    : '<a href="/login">Log in</a><a class="btn small" href="/signup">Join</a>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(title)} · ${h(config.siteName)}</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/">${h(config.siteName)}</a>
    ${member ? `<form class="search" action="/search"><input name="q" placeholder="Search posts" aria-label="Search posts"></form>` : ''}
    <nav class="account">${account}</nav>
  </div>
  ${nav ? `<nav class="wrap sections">${nav}</nav>` : ''}
</header>
<main class="wrap">
${flash ? `<div class="flash">${h(flash)}</div>` : ''}
${body}
</main>
<footer class="wrap foot">
  <p>${h(config.siteName)} is a members-only forum for verified New Hampshire residents, run by ${h(config.partner.name)}. It is not affiliated with, endorsed by, or operated by the State of New Hampshire or any town or city.</p>
  <p><a href="/about">About</a> · <a href="/rules">Community rules</a> · <a href="/privacy">Privacy &amp; ID handling</a></p>
</footer>
</body>
</html>`;
}

function landing(config) {
  return `
<section class="hero">
  <h1>The social network for New Hampshire residents. Only.</h1>
  <p>Every member shows a New Hampshire ID, or a U.S. passport plus proof of an NH address, before they can read or post. No bots, no out-of-state brigades, no anonymous drive-bys.</p>
  <p><a class="btn" href="/signup">Join and get verified</a> <a class="btn ghost" href="/login">Log in</a></p>
  <p class="muted">Home of the verified-resident discussion threads for <a href="${h(config.partner.url)}">${h(config.partner.name)}</a> stories.</p>
</section>
<section class="grid">
  ${SECTIONS.map((s) => `<div class="card"><h3>${h(s.name)}</h3><p>${h(s.blurb)}</p></div>`).join('')}
</section>
<section class="card">
  <h2>How verification works</h2>
  <ol>
    <li>Create an account with your town and county.</li>
    <li>Upload a photo of your NH driver license or NH non-driver ID. Passport holders add a document showing an NH address.</li>
    <li>Upload a selfie holding the ID so a reviewer can match the face.</li>
    <li>A reviewer checks it. The images are deleted from our servers the moment a decision is made.</li>
  </ol>
</section>`;
}

function authForm(req, kind, values = {}, error = '') {
  const signup = kind === 'signup';
  return `
<section class="card narrow">
  <h1>${signup ? 'Join' : 'Log in'}</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/${kind}">
    ${csrf(req)}
    ${values.next ? `<input type="hidden" name="next" value="${h(values.next)}">` : ''}
    <label>Email <input type="email" name="email" required value="${h(values.email)}" autocomplete="email"></label>
    <label>Password <input type="password" name="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    ${signup ? `
    <label>Display name <input name="display_name" required maxlength="60" value="${h(values.display_name)}"></label>
    <label>Town or city <input name="town" required maxlength="60" value="${h(values.town)}"></label>
    <label>County <select name="county" required>${countyOptions(values.county, 'Choose a county')}</select></label>
    <label class="check"><input type="checkbox" name="adult" value="1" required> I am 18 or older and a New Hampshire resident.</label>
    <label class="check"><input type="checkbox" name="rules" value="1" required> I agree to the <a href="/rules">community rules</a> and <a href="/privacy">privacy terms</a>.</label>
    <p class="muted">Password: 10 characters minimum.</p>` : ''}
    <button class="btn">${signup ? 'Create account' : 'Log in'}</button>
  </form>
  <p class="muted">${signup ? 'Already a member? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Join</a> · <a href="/forgot">Forgot password?</a>'}</p>
</section>`;
}

function verifyPage(req, latest, error = '') {
  const u = req.user;
  let status = '';
  if (u.status === 'pending') status = '<p class="flash">Your documents are in the review queue. You will get access as soon as a reviewer approves them.</p>';
  if (u.status === 'unverified' && latest && latest.status === 'expired') status = '<p class="error">Your last submission expired before review and its images were deleted. Please submit again.</p>';
  if (u.status === 'rejected') status = `<p class="error">Your last submission was not approved${latest && latest.note ? `: ${h(latest.note)}` : '.'} You can submit again.</p>`;
  if (u.status === 'suspended') return '<section class="card narrow"><h1>Account suspended</h1><p>Contact the moderators if you think this is a mistake.</p></section>';
  const form = u.status === 'pending' ? '' : `
  <form method="post" action="/verify" enctype="multipart/form-data">
    ${csrf(req)}
    <label>Document type
      <select name="doc_type" required>
        ${DOC_TYPES.map((d) => `<option value="${d.value}">${h(d.label)}</option>`).join('')}
      </select>
    </label>
    <label>Front of ID (JPG, PNG, or PDF, 8 MB max) <input type="file" name="id_front" accept="image/jpeg,image/png,application/pdf" required></label>
    <label>Back of ID (not needed for a passport book) <input type="file" name="id_back" accept="image/jpeg,image/png,application/pdf"></label>
    <label>Selfie holding the ID next to your face <input type="file" name="selfie" accept="image/jpeg,image/png" required></label>
    <label>Proof of NH address (required with a passport: utility bill, lease, bank statement, or NH vehicle registration, dated within 90 days)
      <input type="file" name="address_proof" accept="image/jpeg,image/png,application/pdf"></label>
    <p class="muted">You may cover your ID number and date of birth except the year. The reviewer needs your name, photo, NH address, expiration date, and enough to confirm you are 18 or older.</p>
    <button class="btn">Submit for review</button>
  </form>`;
  return `
<section class="card narrow">
  <h1>Verify your New Hampshire residency</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  ${status}
  <p>Membership is limited to New Hampshire residents 18 and older. A human reviewer compares your ID to your selfie and your account details.</p>
  <p><strong>What we keep:</strong> the document type, the decision, and the date. <strong>What we delete:</strong> every uploaded image, as soon as the review is done. Details on the <a href="/privacy">privacy page</a>.</p>
  ${form}
</section>`;
}

const place = (p) => (p.source_url ? 'Statewide' : `${h(p.county)} County`);
const byline = (p) => (p.source_url
  ? `story from <a href="${h(p.source_url)}" rel="noopener">${h(p.display_name)}</a>`
  : `by <a href="/u/${p.user_id}">${h(p.display_name)}</a> of ${h(p.town)}`);

function postRow(p) {
  return `
<article class="post-row">
  <div class="meta"><a class="tag" href="/s/${h(p.section)}">${h(sectionName(p.section))}</a> ${place(p)} · ${date(p.created_at)}</div>
  <h3><a href="/p/${p.id}">${h(p.title)}</a> ${p.price_cents != null ? `<span class="price">${money(p.price_cents)}</span>` : ''}</h3>
  <div class="meta">${byline(p)} · ${p.comment_count || 0} comments</div>
</article>`;
}

function feed(req, { posts, heading, blurb, section, county, q }) {
  const newLink = section && section !== 'news' ? `/new?section=${h(section)}` : '/new';
  return `
<div class="feed-head">
  <div><h1>${h(heading)}</h1>${blurb ? `<p class="muted">${h(blurb)}</p>` : ''}</div>
  <a class="btn" href="${newLink}">New post</a>
</div>
<form class="filters" method="get">
  ${q != null ? `<input type="hidden" name="q" value="${h(q)}">` : ''}
  <select name="county">${countyOptions(county, 'All counties')}</select>
  <button class="btn small ghost">Filter</button>
</form>
${posts.length ? posts.map(postRow).join('') : '<p class="muted">Nothing here yet. Start it off.</p>'}`;
}

function newPostForm(req, values = {}, error = '', editId = null) {
  const sections = SECTIONS.filter((s) => s.slug !== 'news');
  return `
<section class="card narrow">
  <h1>${editId ? 'Edit post' : 'New post'}</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="${editId ? `/p/${editId}/edit` : '/posts'}">
    ${csrf(req)}
    ${editId ? `<p class="muted">Section: ${h(sectionName(values.section))}</p>` : `<label>Section <select name="section" required>
      ${sections.map((s) => `<option value="${s.slug}" ${s.slug === values.section ? 'selected' : ''}>${h(s.name)}</option>`).join('')}
    </select></label>`}
    <label>County <select name="county" required>${countyOptions(values.county || req.user.county)}</select></label>
    <label>Title <input name="title" required maxlength="140" value="${h(values.title)}"></label>
    <label>Post <textarea name="body" required rows="8" maxlength="10000">${h(values.body)}</textarea></label>
    <label>Price, Marketplace only (e.g. 25 or 25.00) <input name="price" inputmode="decimal" value="${h(values.price)}"></label>
    <label>Link, optional (https:// only) <input name="link" type="url" value="${h(values.link)}"></label>
    <button class="btn">${editId ? 'Save changes' : 'Publish'}</button>
  </form>
</section>`;
}

function postPage(req, post, comments) {
  const canDelete = req.user.id === post.user_id || req.user.role === 'admin';
  return `
<article class="card">
  <div class="meta"><a class="tag" href="/s/${h(post.section)}">${h(sectionName(post.section))}</a> ${place(post)} · ${date(post.created_at)}</div>
  <h1>${h(post.title)} ${post.price_cents != null ? `<span class="price">${money(post.price_cents)}</span>` : ''}</h1>
  <div class="meta">${byline(post)} ${post.source_url ? '' : '<span class="badge">Verified NH</span>'}${post.edited_at ? ' · edited' : ''}</div>
  <div class="body">${paragraphs(post.body)}</div>
  ${post.link ? `<p><a href="${h(post.link)}" rel="nofollow noopener noreferrer" target="_blank">${post.source_url ? 'Read the full story' : h(post.link)}</a></p>` : ''}
  <div class="actions">
    ${post.section === 'marketplace' && req.user.id !== post.user_id ? '<p class="muted">Reply below or message the seller through the comments. Meet in a public place; never send payment in advance to someone you have not met.</p>' : ''}
    <details><summary>Report this post</summary>
      <form method="post" action="/p/${post.id}/report">${csrf(req)}
        <input name="reason" required maxlength="300" placeholder="What is wrong with it?"><button class="btn small ghost">Send report</button>
      </form>
    </details>
    ${req.user.id === post.user_id && !post.source_url ? `<a class="btn small ghost" href="/p/${post.id}/edit">Edit</a>` : ''}
    ${canDelete ? `<form method="post" action="/p/${post.id}/delete" class="inline">${csrf(req)}<button class="btn small danger">Remove post</button></form>` : ''}
  </div>
</article>
<section class="card">
  <h2>Comments</h2>
  ${comments.map((c) => `
    <div class="comment"><div class="meta"><a href="/u/${c.user_id}">${h(c.display_name)}</a> of ${h(c.town)} · ${date(c.created_at)}</div>${paragraphs(c.body)}</div>`).join('') || '<p class="muted">No comments yet.</p>'}
  <form method="post" action="/p/${post.id}/comments">${csrf(req)}
    <textarea name="body" required rows="3" maxlength="4000" placeholder="Add a comment"></textarea>
    <button class="btn small">Comment</button>
  </form>
</section>`;
}

function profilePage(req, user, posts) {
  const admin = req.user.role === 'admin' && user.id !== req.user.id;
  return `
<section class="card">
  <h1>${h(user.display_name)} ${user.status === 'verified' ? '<span class="badge">Verified NH</span>' : ''}</h1>
  <p class="muted">${h(user.town)}, ${h(user.county)} County · member since ${date(user.created_at)}</p>
  ${user.bio ? paragraphs(user.bio) : ''}
  ${req.user.id === user.id ? `
  <details><summary>Edit bio</summary>
    <form method="post" action="/profile">${csrf(req)}<textarea name="bio" rows="3" maxlength="500">${h(user.bio)}</textarea><button class="btn small">Save</button></form>
  </details>` : ''}
  ${admin ? `<form method="post" action="/admin/users/${user.id}/${user.status === 'suspended' ? 'reinstate' : 'suspend'}" class="inline">${csrf(req)}
    <button class="btn small danger">${user.status === 'suspended' ? 'Reinstate' : 'Suspend'} user</button></form>` : ''}
</section>
<h2>Posts</h2>
${posts.map(postRow).join('') || '<p class="muted">No posts yet.</p>'}`;
}

function adminHome(req, pending, reports) {
  return `
<h1>Moderation</h1>
<section class="card">
  <h2>Verification queue (${pending.length})</h2>
  ${pending.map((v) => `<p><a href="/admin/verifications/${v.id}">${h(v.display_name)}</a> · ${h(v.email)} · ${h(v.town)}, ${h(v.county)} · ${h(v.doc_type)} · submitted ${date(v.submitted_at)}</p>`).join('') || '<p class="muted">Queue is empty.</p>'}
</section>
<section class="card">
  <h2>Open reports (${reports.length})</h2>
  ${reports.map((r) => `
    <div class="comment">
      <p><a href="/p/${r.post_id}">${h(r.title)}</a> reported by ${h(r.reporter)}: ${h(r.reason)}</p>
      <form method="post" action="/admin/reports/${r.id}/resolve" class="inline">${csrf(req)}
        <button class="btn small ghost" name="action" value="dismiss">Dismiss</button>
        <button class="btn small danger" name="action" value="remove">Remove post</button>
      </form>
    </div>`).join('') || '<p class="muted">No open reports.</p>'}
</section>`;
}

function adminVerification(req, v, files) {
  const doc = DOC_TYPES.find((d) => d.value === v.doc_type);
  return `
<section class="card">
  <h1>Review: ${h(v.display_name)}</h1>
  <p>Email: ${h(v.email)} · Claimed town: <strong>${h(v.town)}</strong>, ${h(v.county)} County · Document: ${h(doc ? doc.label : v.doc_type)}</p>
  <h3>Checklist</h3>
  <ul>
    <li>Document is a ${doc && doc.needsAddressProof ? 'U.S. passport or passport card, and the proof of address shows a New Hampshire address dated within 90 days' : 'New Hampshire-issued license or ID showing a New Hampshire address'}.</li>
    <li>Document is unexpired and shows no signs of editing.</li>
    <li>Name matches across documents; face in the selfie matches the ID photo.</li>
    <li>Holder is 18 or older.</li>
  </ul>
  <div class="files">
    ${files.map((f, i) => `<figure><figcaption>${h(f.field)}</figcaption>${f.mime === 'application/pdf'
      ? `<a class="btn small ghost" href="/admin/verifications/${v.id}/file/${i}" target="_blank" rel="noopener">Open PDF</a>`
      : `<img src="/admin/verifications/${v.id}/file/${i}" alt="${h(f.field)}">`}</figure>`).join('')}
  </div>
  <form method="post" action="/admin/verifications/${v.id}">${csrf(req)}
    <label>Note to member (shown if rejected) <input name="note" maxlength="300"></label>
    <button class="btn" name="decision" value="approve">Approve</button>
    <button class="btn danger" name="decision" value="reject">Reject</button>
  </form>
  <p class="muted">Deciding deletes every uploaded file for this submission.</p>
</section>`;
}

function storiesPanel(config, stories) {
  if (!stories.length) return '';
  return `
<section class="card stories">
  <h2>Latest from <a href="${h(config.partner.url)}">${h(config.partner.name)}</a></h2>
  ${stories.map((s) => `
    <div class="story">
      <a class="story-title" href="${h(s.url)}" rel="noopener">${h(s.title)}</a>
      <a class="btn small ghost" href="/discuss?url=${encodeURIComponent(s.url)}">Discuss</a>
    </div>`).join('')}
</section>`;
}

function forgotForm(req, error = '') {
  return `
<section class="card narrow">
  <h1>Reset your password</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/forgot">${csrf(req)}
    <label>Email <input type="email" name="email" required autocomplete="email"></label>
    <button class="btn">Send reset link</button>
  </form>
</section>`;
}

function resetForm(req, token, error = '') {
  return `
<section class="card narrow">
  <h1>Choose a new password</h1>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <form method="post" action="/reset/${h(token)}">${csrf(req)}
    <label>New password (10 characters minimum) <input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
    <button class="btn">Save password</button>
  </form>
</section>`;
}

function accountPage(req, error = '') {
  const u = req.user;
  return `
<section class="card narrow">
  <h1>Your account</h1>
  <p>${h(u.email)} · ${h(u.town)}, ${h(u.county)} County · status: ${h(u.status)}</p>
  <p><a href="/forgot">Change password</a></p>
</section>
<section class="card narrow">
  <h2>Delete account</h2>
  ${error ? `<p class="error">${h(error)}</p>` : ''}
  <p>This permanently deletes your account, posts, comments, and any ID records or images we still hold. It cannot be undone.</p>
  <form method="post" action="/account/delete">${csrf(req)}
    <label>Confirm with your password <input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn danger">Delete my account</button>
  </form>
</section>`;
}

const staticPages = {
  about: (config) => `<section class="card"><h1>About ${h(config.siteName)}</h1>
    <p>${h(config.siteName)} is a social platform with one membership rule: you live in New Hampshire, and you proved it. Verified residents use it to follow state and town government, buy and sell locally, argue in good faith, share information, and help each other.</p>
    <p>It is run by ${h(config.partner.name)}. Each ${h(config.partner.name)} story gets its own discussion thread in the News section.</p>
    <p>Content is visible only to verified members. It is not indexed by search engines.</p></section>`,
  rules: () => `<section class="card"><h1>Community rules</h1><ol>
    <li>One account per person. Your display name should be a name people in your town would recognize.</li>
    <li>No threats, harassment, or doxxing. Do not post anyone's home address, phone number, or ID.</li>
    <li>Criticize ideas and public conduct, not a neighbor's family or appearance.</li>
    <li>Marketplace: only lawful goods and services. Anything that needs a license or a background check to sell follows the same rules here as anywhere else.</li>
    <li>Label opinion as opinion. Link a source when you state a fact others may dispute.</li>
    <li>No spam and no mass commercial advertising outside the Marketplace.</li>
    <li>Moderators may remove posts and suspend accounts that break these rules.</li></ol></section>`,
  privacy: (config) => `<section class="card"><h1>Privacy &amp; ID handling</h1>
    <h3>ID documents</h3>
    <ul>
      <li>Uploaded ID images, selfies, and address documents are stored on a private disk that the web server never serves publicly.</li>
      <li>Only moderators with an admin account can open them, and only while the review is open.</li>
      <li>When a moderator approves or rejects, every uploaded file for that submission is deleted. We keep the document type, the decision, and the date.</li>
      <li>We never sell, share, or publish ID data.</li>
    </ul>
    <h3>Account data</h3>
    <p>We store your email, a salted password hash, your display name, town, county, bio, and what you post. Your email is never shown to other members.</p>
    <p>Questions or deletion requests: contact the site operator at the address listed for ${h(config.domain)}.</p></section>`,
};

module.exports = {
  h, layout, landing, authForm, verifyPage, feed, newPostForm, postPage,
  profilePage, adminHome, adminVerification, staticPages,
  storiesPanel, forgotForm, resetForm, accountPage,
};
