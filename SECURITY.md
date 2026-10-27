# Security policy

AgroHands handles identity data (NIN hashes), phone numbers, locations and signed employment contracts, so we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. Include steps to reproduce and the impact you see.

We aim to acknowledge reports within 3 working days and to fix confirmed high-severity issues within 14 days. We credit reporters who want credit.

## Scope

In scope: this codebase, the Docker images it builds, and the deployment configuration in `deploy/` and `android/`.
Out of scope: denial-of-service by volume, social engineering, and issues in third-party services (Africa's Talking, Dojah, Google Play).

## Built-in protections

PBKDF2-hashed PINs with lockout · HMAC-signed sessions · CSRF tokens · per-IP rate limits · strict CSP and HSTS · all output escaped · full NINs never stored · proxy-aware IP capture for signature evidence · read-only, capability-dropped containers · zero runtime npm dependencies.
