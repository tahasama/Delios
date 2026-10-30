# The sandbox: DELIOS live for testing, on free services

What it is: the real app, on the internet, for the team and anyone invited to try it, with **made-up data only**
(companies, people, files). Every page and every email says it is a sandbox. Nothing here is for real work, and it may
be wiped at any time.

What it costs: **a domain name** (about €10 a year). Everything else below has a free plan. Free plans change: check
each one's page before you sign up.

Who can do it: anyone who can follow steps and copy text. No code is changed.

---

## What you need (free)

| What | Free choice | What it is for |
|---|---|---|
| A server | Oracle Cloud "Always Free" (an Ampere virtual machine) | Runs the whole app with Docker |
| A domain | Bought once (any registrar, ~€10 a year) | The address, e.g. `sandbox.yourname.com` |
| DNS and protection | Cloudflare, free plan | Points the address to the server; the bot check on sign-up (Turnstile) |
| Email | Brevo (about 300 a day) or Resend (about 3,000 a month) | Invitations, password links, notifications |
| Error tracking | Sentry, free plan | Errors reach you (optional) |
| Backups off the server | Backblaze B2 (10 GB free) | Only if you want the sandbox kept; it is fake data |

**One thing to check first:** Oracle's free machines are ARM processors. Most of DELIOS's parts run on ARM; if one
refuses to start ("exec format error"), use a small ordinary (x86) server instead, e.g. Hetzner CX22, about €4 a month.

---

## Steps

### 1. The server
1. Create the machine (Ubuntu 24.04), give it at least 8 GB of memory (the virus scanner alone takes 2–3 GB).
2. Open ports 80 and 443 in the cloud's firewall (Oracle: "Security list" of the network).
3. Install Docker, then copy the repository onto it:

```bash
git clone <the repository's address> delios && cd delios
```

```bash
sh deploy/init-env.sh
```

This writes `.env` with new random passwords. **Copy `.env` somewhere safe off the server** (a password manager).

### 2. The address
1. At Cloudflare, add your domain, then a record `sandbox` → the server's public IP address.
2. In `.env`:

```bash
SITE_ADDRESS=sandbox.yourname.com
PUBLIC_URL=https://sandbox.yourname.com
SECURE_COOKIE=true
HTTP_PORT=80
HTTPS_PORT=443
```

The certificate (the padlock) is made and renewed by itself.

### 3. It is a sandbox
In `.env`:

```bash
SANDBOX=true
APP_ENVIRONMENT=Production
SIGN_UP_ENABLED=true
```

`SANDBOX=true` puts the sandbox band on every page, the note on sign-in and sign-up, and "[Sandbox]" on every email.

### 4. The bot check on sign-up
At Cloudflare → Turnstile, add a widget for your address, then in `.env`:

```bash
TURNSTILE_SITE_KEY=<site key>
TURNSTILE_SECRET_KEY=<secret key>
```

### 5. Email
At Brevo (or Resend), verify your domain (they show the DNS records to add at Cloudflare), then in `.env`:

```bash
EMAIL_ENABLED=true
EMAIL_FROM=sandbox@yourname.com
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<the login Brevo gives>
SMTP_PASSWORD=<the SMTP key Brevo gives>
```

(Resend: `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, `SMTP_PASSWORD=` your API key.)

### 6. Errors (optional)
Create a Sentry project (type ".NET"), then `SENTRY_DSN=<its address>` in `.env`.

### 7. Start it

```bash
docker compose --profile app up -d --build
```

### 8. The console account (the team's own space)

```bash
docker compose --profile app run --rm -e DELIOS_OPERATOR_PASSWORD='<a long password, 14 characters or more>' migrate create-operator you@yourname.com "Your Name"
```

Open `https://sandbox.yourname.com/console`, sign in, scan the QR code with an authenticator app.

### 9. Check
- `https://sandbox.yourname.com` opens, with the sandbox band at the bottom.
- Sign up a made-up company; the email with the link arrives, marked "[Sandbox]".
- Upload a file to a document, then open it.

---

## Keeping it a sandbox
- Never put real documents or real people's data in it. Say so to everyone you invite.
- To start it again from nothing: stop it, remove its Docker volumes, start it again (the app owner only).
- Payments: card payment is not connected; plans and invoices can be tried by hand from the console.
