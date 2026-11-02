# fail2ban: ban web probers at Cloudflare

The monitor (`scripts/monitor.ts`, `lib/probe-traffic.ts`) emails admins
about probe traffic. These jails ban the prober automatically, whatever IP
it uses next. The host's fail2ban reads nginx's access log and puts the IP
behind a Cloudflare **managed challenge** through the bundled
`cloudflare-token` action. A local firewall ban would be useless, since
every request arrives from a Cloudflare edge.

Added after 2026-10-23, when one VPS IP fuzzed the auth routes for hours and
cloud-hosted scanners swept for `/.env` and `/.aws/credentials`.

## Files

- `filter.d/nginx-scanner.conf`: requests for dotfiles, cloud credentials
  and PHP/WordPress paths.
- `filter.d/nginx-api-probe.conf`: API calls answered with a 4xx, except 429 and
  preflights.
- `jail.d/crypteo.local`:
  - `crypteo-scanner`: 5 scanner requests in 10 min → 1 week ban.
  - `crypteo-api-probe`: 60 API 4xx (not 429) in 10 min → 1 hour ban.

  Repeat offenders' bans double, up to 4 weeks for scanners and 1 day for
  API errors.

## Legitimate users are never locked out

- **A ban is a challenge, not a block.** Scripts can't pass it. A person who
  shares the IP (carrier NAT, an office, a VPN) clicks through and carries
  on.
- **429 never counts.** The rate limiter already answered it, and
  legitimate traffic reaches it: several buyers polling checkout every 10s
  behind one carrier NAT, or a busy merchant integration.
- **Bans expire.** The rule's note has no spaces (`Fail2Ban-<jail>`):
  fail2ban 1.0.2's unban looks the rule up by its note in an unencoded URL,
  so a note with a space was never found and every ban stayed forever.
- **`ignoreip`** covers localhost, Docker's networks, this host and the
  owner's IP. A merchant's server can't pass a challenge, so if a merchant's
  integration gets caught, add its server IPs to `ignoreip` in both jails
  and reload. Their 4xx still raise the monitor's email.
- To lift a ban by hand: `sudo fail2ban-client set <jail> unbanip <ip>`,
  then check the rule is gone from the zone's IP Access Rules.

Both filters are twins of `isProbeRequest` in `lib/probe-traffic.ts`.
`lib/fail2ban-parity.test.ts` fails if they disagree on a log line.

## Placeholders in `jail.d/crypteo.local`

| Placeholder | Value |
|---|---|
| `HOST_IPS` | this host's public IPv4 and IPv6 (`WEBHOOK_BLOCKED_IPS` in `.env`) |
| `OWNER_IP` | the owner's current IP, so testing never bans them. Update it when it changes |
| `ZONE_ID` | the domain's Overview page in Cloudflare, right column, **API** |
| `API_TOKEN` | Cloudflare → My Profile → API Tokens → Custom token: *Zone · Firewall Services · Edit*, limited to this zone |

Don't commit the filled-in copy: the server's IP is what Cloudflare hides,
and the token can edit the zone's firewall.

## Install (root on the host)

```bash
sudo cp ~/crypteo/fail2ban/filter.d/*.conf /etc/fail2ban/filter.d/
sudo install -m 640 -o root -g root ~/crypteo/fail2ban/jail.d/crypteo.local /etc/fail2ban/jail.d/
sudo nano /etc/fail2ban/jail.d/crypteo.local   # fill in the placeholders
sudo fail2ban-client -t && sudo systemctl reload fail2ban
sudo fail2ban-client status crypteo-scanner
```

Test with a documentation-only address and confirm the rule appears in, then
**leaves**, the zone's IP Access Rules. A rule that stays means unbans are
broken:

```bash
sudo fail2ban-client set crypteo-scanner banip 192.0.2.1
sudo fail2ban-client set crypteo-scanner unbanip 192.0.2.1
```

When a filter changes in the repo, copy it again and reload. Check a filter
against the live log with:

```bash
docker exec crypteo-nginx-1 cat /var/log/nginx/access.log > /tmp/access.log
fail2ban-regex /tmp/access.log /etc/fail2ban/filter.d/nginx-api-probe.conf
```
