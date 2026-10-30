# The sandbox: DELIOS live for testing, on free services

What it is: the real app, on the internet, for the team and anyone invited to try it, with **made-up data only**
(companies, people, files). Every page and every email says it is a sandbox. Nothing here is for real work, and it may
be wiped at any time.

What it costs: **nothing**. The address is a free one (DuckDNS); everything else below has a free plan. A paid domain
(about €10 a year) is only for later, when the address should carry your name. Free plans change: check
each one's page before you sign up.

Who can do it: anyone who can follow steps and copy text. No code is changed.

---

## What you need (free)

| What | Free choice | What it is for |
|---|---|---|
| A server | Oracle Cloud "Always Free" (an Ampere virtual machine) | Runs the whole app with Docker |
| An address | DuckDNS, free (sign in with Google or GitHub) | The address, e.g. `delios-sandbox.duckdns.org` |
| Bot check | Cloudflare Turnstile, free (no domain needed) | Stops robots signing up |
| Email | Brevo (about 300 a day) or Resend (about 3,000 a month) | Invitations, password links, notifications |
| Error tracking | Sentry, free plan | Errors reach you (optional) |
| Backups off the server | Backblaze B2 (10 GB free) | Only if you want the sandbox kept; it is fake data |

**Oracle's free machines are ARM processors.** DELIOS's own parts are built on the machine itself, so they fit; the
virus scanner needs its ARM image, one line in `.env` (step 3). If another part still refuses to start ("exec format
error"), use a small ordinary (x86) server instead, e.g. Hetzner CX22, about €4 a month, and leave that line out.

---

## Steps

### 1. The server
1. At cloud.oracle.com, create an account (a card is asked to prove who you are; the "Always Free" machines are never
   charged). Create an instance: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** with **4 OCPUs and 24 GB** (the
   free allowance), and download the SSH key it offers.
2. Open ports 80 and 443 in the cloud's firewall: the instance's subnet → Security list → Add ingress rules, source
   `0.0.0.0/0`, TCP, ports `80` and `443`.
3. Connect to it (`ssh -i <the key> ubuntu@<its public IP>`), then open the same ports in the machine's own firewall
   (Oracle's Ubuntu closes them a second time):

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save
```

4. Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu
```

   Then disconnect and connect again, so Docker works without `sudo`.
5. Copy the code onto it. The repository is private: at GitHub → Settings → Developer settings → Personal access
   tokens, make a token that may read this repository, and use it as the password when asked:

```bash
git clone https://github.com/tahasama/Delios.git delios && cd delios
```

```bash
sh deploy/init-env.sh
```

This writes `.env` with new random passwords. **Copy `.env` somewhere safe off the server** (a password manager).

### 2. The address
1. At duckdns.org, sign in, choose a name (e.g. `delios-sandbox`) and put the server's public IP address beside it.
2. In `.env`:

```bash
SITE_ADDRESS=delios-sandbox.duckdns.org
PUBLIC_URL=https://delios-sandbox.duckdns.org
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
COMPOSE_PROFILES=app
CLAMAV_IMAGE=clamav/clamav-debian:stable
```

(The last line only on an ARM machine, Oracle's.) `SANDBOX=true` puts the sandbox band on every page, the note on sign-in and sign-up, and "[Sandbox]" on every email.

### 4. The bot check on sign-up
At Cloudflare → Turnstile, add a widget for your address, then in `.env`:

```bash
TURNSTILE_SITE_KEY=<site key>
TURNSTILE_SECRET_KEY=<secret key>
```

### 5. Email
A free address has no mailbox of its own, so emails go out from an address you already have: at Brevo, add it as a
sender (Brevo emails it a link to confirm), then in `.env`:

```bash
EMAIL_ENABLED=true
EMAIL_FROM=<the address you confirmed at Brevo>
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<the login Brevo gives>
SMTP_PASSWORD=<the SMTP key Brevo gives>
```

Some emails may land in spam: fine for testing (a paid domain later fixes it). Or leave email off (`EMAIL_ENABLED=false`):
the app then shows each invitation's and password link on screen to whoever made it, to pass on by hand.

### 6. Errors (optional)
Create a Sentry project (type ".NET"), then `SENTRY_DSN=<its address>` in `.env`.

### 7. Start it

```bash
docker compose --profile app up -d --build
```

The first time takes 15 to 30 minutes (everything is built on the machine, and the virus scanner downloads its
signatures). `docker compose ps` shows each part; all should read "running" or "healthy".

### 8. The console account (the team's own space)

```bash
docker compose --profile app run --rm -e DELIOS_OPERATOR_PASSWORD='<a long password, 14 characters or more>' migrate create-operator you@example.com "Your Name"
```

Open `https://delios-sandbox.duckdns.org/console`, sign in, scan the QR code with an authenticator app.

### 9. Check
- `https://delios-sandbox.duckdns.org` opens, with the sandbox band at the bottom.
- Sign up a made-up company; the email with the link arrives, marked "[Sandbox]".
- Upload a file to a document, then open it.

---

### 10. Updating it later

```bash
cd delios && git pull && docker compose --profile app up -d --build
```

---

## Keeping it a sandbox
- Never put real documents or real people's data in it. Say so to everyone you invite.
- To start it again from nothing: stop it, remove its Docker volumes, start it again (the app owner only).
- Payments: card payment is not connected; plans and invoices can be tried by hand from the console.
