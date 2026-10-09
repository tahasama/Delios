# Before launch: documents, services and security

This page reviews the list of concerns you sent. For each one it says where the app stands today (checked
in the code, not guessed), what we would need, and when to add it. Prices are from 9 Oct 2026; check them
on the provider's own page before you pay.

Short version:
- **Fixed now:** uploaded files could run script when opened. See section 6.
- **Add before launch:** security headers (section 6), Cloudflare in front (section 3), and a password-reset flow
  (section 5). Also have the legal documents written (section 1).
- **Before a server goes on the internet:** close the internal service ports that `deploy/compose.yaml`
  publishes (section 8).
- **Already in place:** sign-in limits, ownership checks on every request, IDs that cannot be guessed, an
  organization wall inside the database, and an audit trail.

---

## 1. Legal documents

| Document | Needed? | Notes |
|---|---|---|
| Terms of service | **Yes** | For self-service customers (sign-up). It covers use, accounts, liability limits, suspension and the law that applies. |
| Privacy policy | **Yes** | You hold personal data: names, emails, sign-in IP addresses and an audit trail of who did what. Say what you keep, why, for how long, and who your providers are. |
| Data processing agreement (DPA) | **Yes** | Your customers decide what goes into the app (they are the *controller*), and you hold it for them (you are the *processor*). Under GDPR every business customer needs one. Attach a **list of sub-processors**: hosting, email provider, Cloudflare, and the AI provider if you use one. |
| Refund policy | Only if you charge online | It can be a clause in the terms of service or the MSA rather than its own page. |
| Master service agreement (MSA) | **Yes, for larger customers** | Engineering and construction firms will want an MSA plus an order form, not click-through terms. Put the service level (uptime, support hours, backups) in it or in an SLA attached to it. |
| Cyber liability insurance | **Yes, but you buy it, you don't write it** | Large customers will ask for proof. Ask your broker about **professional indemnity (errors & omissions)** at the same time. |

Also worth having, because customers' IT teams will ask:
- a one-page security overview (you can build it from this page);
- a data retention and deletion statement (we never delete; only the app owner removes data);
- an incident response plan (who is told, how fast);
- a backup and restore statement (`docs/ACTIVATION.md` already describes the restore drill);
- an acceptable use policy.

A lawyer should write or check the first five. Templates are a starting point, not the finished thing.

---

## 2. latent-spaces/brag (turning the app into a video)

- **What it is:** [github.com/latent-spaces/brag](https://github.com/latent-spaces/brag) is a Claude Code skill, MIT licensed.
- **What it makes:** a short launch video, about 15–25 seconds, from your project. It reads the project and writes
  a storyboard, then renders the video with the Hyperframes tool. It needs Node 22+ and FFmpeg.
- **How established it is:** started in June 2026, very popular (about 14,000 stars), still young.
- **Good for:** a teaser for a launch post or the website.
- **Not for:** tutorials or "how do I…" walkthroughs. For those, record the real app. We already drive the app with
  Playwright in tests, so scripted recordings of real flows are cheap to add.
- **Cost and risk:** it runs locally, so it costs nothing to try.

---

## 3. What Cloudflare can do for us

Put the whole site behind Cloudflare. In order of value:

1. **TLS, DNS and DDoS protection.** DDoS protection is unlimited on every plan.
2. **WAF (web application firewall).**
   - Managed rules: the Free plan gets a small set. Pro and above get the full managed set, which covers SQL
     injection, XSS and path traversal.
   - Custom rules: 5 on Free, 20 on Pro, 100 on Business.
3. **Rate-limiting rules** at the edge: 1 on Free, 2 on Pro, 5 on Business. Use them for `/api/auth/*`
   (section 4).
4. **Bots:**
   - Free: Bot Fight Mode.
   - Pro: Super Bot Fight Mode.
   - Business: adds machine-learning detection of sophisticated bots.
   - Full Bot Management is Enterprise only.
5. **Turnstile:** a free CAPTCHA replacement. Put it on sign-up, and on sign-in after a failed attempt.
6. **Leaked-credentials detection:** spots sign-ins that use passwords known from breaches. It is on for free;
   acting on it in a custom rule needs Pro.
7. **Tunnel** (free): the server opens no ports to the internet at all, and Cloudflare reaches it through an
   outgoing tunnel.
8. **Zero Trust Access** (free up to 50 users): a sign-in wall in front of Grafana, the RabbitMQ console and
   SeaweedFS, so those are never public.
9. **R2 file storage:** about $0.015 per GB per month, and no fees to download. It is S3-compatible, so the
   backend could use it instead of SeaweedFS with only a settings change.

Not worth it yet: API Shield schema validation and custom-certificate mTLS are Enterprise only.

**Recommendation:** start on **Pro** (about $20/month billed yearly). Move to **Business** (about $200/month)
when a large customer asks for more rules or bot analytics.

---

## 4. Email

The backend sends through plain **SMTP**, so any provider below works with a settings change only. The
settings are `Email:*` in `deploy/.env`.

Approximate cost for 100,000 emails a month:

| Provider | Cost | Notes |
|---|---|---|
| **Amazon SES** (EU region) | **about $10** | Cheapest by far, with good deliverability once SPF, DKIM and DMARC are set up. |
| Resend | about $35 | Easiest to set up, but account data stays in the US. |
| SendGrid | $35–90 | EU data residency on higher plans. |
| Brevo | $69–82 | A French company, so EU-based. |
| Mailgun | $75–90 | Has an EU region. |
| Postmark | about $115 | Best reputation for delivery, but no EU hosting. |
| Cloudflare Email Service | about $35 | Still in beta. |

**Recommendation:** **Amazon SES in Frankfurt or Ireland.** Set up SPF, DKIM and DMARC on your domain before the
first email goes out.

---

## 5. Bots, credential stuffing and sign-in fraud

| Concern | Where we stand | What to add |
|---|---|---|
| **Rate limits on sign-in** | Done in the backend: 10 sign-ins a minute per IP, the same for the two-step code, and the account locks after repeated wrong passwords or codes. | A Cloudflare rate-limiting rule on `/api/auth/*`, so attacks are stopped before they reach the server. |
| **Bot rules on high-value pages** | Nothing yet. | Super Bot Fight Mode, plus Turnstile on sign-up and on sign-in after a failure. |
| **Custom WAF rules (SQL injection, XSS, query strings, form fields, path traversal)** | In the app: every database query takes its values as parameters; the screens escape everything they show; stored file names are random IDs, never a path someone typed. | The Cloudflare managed rules (Pro) as the outer layer. Add a custom rule that blocks `/api/admin/*` from countries you never work in. |
| **Leaked passwords** | Not checked. | Refuse passwords found in known breaches when one is set (Have I Been Pwned, which never sees the password itself). |
| **Two-step sign-in** | The backend already had it. **The sign-in page now asks for the code**, and walks people through first-time setup with recovery codes. | Encourage administrators to require it for their organization (the setting exists). |
| **Password reset** | **There is none.** An administrator has to set a new password. | A "forgot password" email with a single-use link that expires in about 30 minutes. Needed before self-service sign-up. |
| **Verify ownership on every API request** | Yes. Every project address loads your place on that project first, and answers "not found" if you have none. Documents are filtered to what you may read (function, clearance, named readers). Below that, the database itself refuses rows from another organization (row-level security). | An automated test that tries every address with a person from another project and another organization. |
| **No sequential IDs in URLs** | Yes. Every ID is a random UUID (version 7): time-ordered, but with 74 random bits, so it cannot be guessed. Document numbers are shown on screen but never used to look something up. | Nothing. |
| **Audit of addresses that take an ID** | Every act and every download is written to the audit trail with the ID. The trail is readable by administrators only. | Also record **refused** attempts (someone opening many IDs they may not see) and raise an alert when one person does it repeatedly. |

**Attacks through the search bar.** The register search passes words to the database as parameters and escapes
`%` and `_`, so nothing typed becomes SQL. It takes at most 8 alternatives of 6 words each. Full-text search
uses a plain match, not a query language, so nothing typed becomes a query either. Results go through the same
visibility filter as everything else. What remains is cost: limit the length of the search box and add a
Cloudflare rate rule on `/api/*/search`.

**Signatures and expiry.**
- **Sessions:** last 12 hours and renew while in use. The cookie is `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Two-step challenge:** expires after 5 minutes.
- **Upload links:** signed, valid 15 minutes.
- **Download links:** signed, valid 5 minutes. Every download is audited.

To add:
- a maximum session age (for example 7 days, even while in use);
- "sign out everywhere";
- signatures on outgoing webhooks, if we ever send them.

---

## 6. Hidden-frame attacks and security headers

**Today the app sends no security headers at all:** no `Content-Security-Policy`, no `frame-ancestors`, no
`X-Frame-Options`, no `Strict-Transport-Security`. Another site could load DELIOS in an invisible frame and trick
a signed-in user into clicking (clickjacking).

**Fixed now** (no change to any screen): opening an uploaded file used to show it inside the app's own address,
whatever it was. An uploaded HTML file would have run as the person opening it. Now:
- Only PDFs and plain images open in the page. Everything else downloads.
- Files carry `nosniff`.
- Files may be framed only by our own pages.
- Downloads run nothing even if a browser opens them.

**To add before launch:** headers on every page, set in Caddy or in `next.config.ts`:
- `Content-Security-Policy: frame-ancestors 'self'`. This blocks the hidden-frame attack and still lets our own
  review page show the PDF.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and a strict
  `Permissions-Policy`.
- Later, a full content security policy with nonces, which needs some care with Next.js.

---

## 7. Application firewall

Use two layers:
1. **Cloudflare WAF at the edge** (section 3) stops most attacks before they reach the server.
2. **Optionally, Coraza on the server:** the open-source ModSecurity successor, with the OWASP Core Rule Set,
   as a Caddy module. It is only worth it if a customer requires an on-premise firewall or you do not use
   Cloudflare.

The app's own checks (ownership, permissions, clearance, the database wall) stay the real protection. A
firewall only filters known attack patterns.

---

## 8. Ubuntu

- **Version:** Ubuntu **24.04 LTS** (standard support until May 2029) is the safe choice for the Docker host.
  **26.04 LTS** (supported until 2031) is fine too, now that 26.04.1 is out.
- **Hardening:**
  - SSH keys only, with password login off;
  - `unattended-upgrades` for security fixes;
  - Ubuntu Pro (free for up to 5 machines) for kernel livepatching;
  - a firewall (`ufw`) allowing only 80 and 443, or nothing at all if Cloudflare Tunnel is used;
  - fail2ban on SSH;
  - Docker kept up to date;
  - the database and the other internal services never published on a public port.

**This last point is not the case today.** `deploy/compose.yaml` publishes these on every network interface of
the machine, which is handy on a laptop but dangerous on a server:

| Service | Ports |
|---|---|
| Postgres | 5432 |
| Postgres standby | 5433 |
| PgBouncer | 6432 |
| Valkey | 6379 |
| RabbitMQ and its console | 5672, 15672 |
| SeaweedFS | 8333 |
| ClamAV | 3310 |

Docker opens these ports **past `ufw`**, so the firewall alone does not close them. Before going live, give
production a compose override that publishes only Caddy (80 and 443), or binds the rest to `127.0.0.1`.

---

## 9. An in-app assistant

**What it would do:** answer "how do I…" and "why can't I…" from the app's own guidance, instead of people
reading documentation. The app already explains every refusal in words (the "why" behind each permission), so
the assistant has good material. It can also:
- tell someone what they can do on this project with their function;
- point them to the right screen;
- explain a refusal message;
- summarize review comments for the author;
- draft a transmittal message;
- check a document title against the naming rules.

**How:**
- Index our own guidance: the guide pages, the flow page, `docs/`, and the value lists with their meanings.
- Add the person's own context: their function, what they may do, and the page they are on.
- Let the model answer **only** from that material.
- It never reads document contents unless we decide to allow it later, and it always respects the same
  permissions as the person.
- It suggests actions; it never acts without the person clicking.

**Which model.** The Qwen family is current: **Qwen3.8** came out in August 2026.

| Option | Model examples | Data | Cost for a few hundred questions a day |
|---|---|---|---|
| Self-hosted on a serverless GPU that scales to zero (RunPod, Modal, Koyeb) | Qwen3.8-27B (Apache-2.0) or Qwen3.6-35B-A3B (fast) on vLLM | Stays with you and the GPU provider; no model company sees it | about **$40–130/month** on an L4 GPU; about $75–250 on an L40S |
| Your own GPU server | Same models | Never leaves your machines | About $500/month for an always-on L4, or the price of the card |
| EU-hosted API, no training on your data | gpt-oss-120b (Scaleway, Paris) or Qwen3.8-27B (OVHcloud) | Processed in the EU by a third party | about **€8–26/month** |

**Recommendation:**
1. Start with the EU-hosted API. It is the cheapest and fastest way to find out whether people use the assistant.
   It only ever sees our guidance and the person's function, never document contents.
2. If customers require that nothing leaves your control, move to Qwen3.8-27B on a serverless GPU. The code is
   the same, because vLLM speaks the same API.

---

## 10. Role-level security

Who sees what is decided in four layers, each checked by the backend:

1. **Organization:** the database itself refuses another organization's rows (Postgres row-level security,
   enforced even for the table owner).
2. **Project:** you must hold a function on the project.
3. **Function:** the permission matrix says which verbs (read, review, approve, control…) you hold for which kind
   of document.
4. **Clearance (new):** a function can be limited to a confidentiality level. Above it, only people named on the
   document, its author, and people it was sent to can read it.

To add: run the app with a database user that owns nothing and cannot change the security policies. Run
migrations with a separate owner account. Then even a compromised app server cannot switch the organization
wall off.

---

## 11. Secrets

- **Today:** secrets live in `deploy/.env`, which git ignores. `init-env.sh` and `init-env.ps1` generate random
  values. Kubernetes has its own example file. Nothing secret is committed.
- **To add for production:**
  - Keep secrets in a secret manager: Docker or Kubernetes secrets, or Infisical or Doppler (Infisical can be
    self-hosted). A simpler option is SOPS-encrypted files in the repository.
  - Use separate secrets per environment.
  - Rotate the database, storage and SMTP passwords at least once a year, and whenever someone leaves.
  - Turn on GitHub secret scanning with push protection.
  - Give the storage keys access to their one bucket only.
