# Deploy SOL TRADER on Render

This package is prepared for deployment, not already deployed. It needs your Render account, a private source repository, bot credentials, and approval of Render's service and disk charges.

## 1. Create accounts and upload source

Create an account at https://dashboard.render.com/register. If you already have GitHub, signing in with it simplifies connecting the source repository. Otherwise, create a GitHub account and a private repository called `sol-trader`.

Extract the ZIP and upload the **contents** of `sol-telegram-bot` to the private repository root. `render.yaml` and `package.json` must be at that root, alongside `src`, `web`, and `test`. Include the dotfiles from the package, especially `.env.example` and `.gitignore`. Do not upload `.env`, wallet files, database files, or `node_modules`.

## 2. Create the Render Blueprint

In Render, choose **New → Blueprint** and connect the private repository. Review the service and disk charges before deploying. This configuration uses a paid Starter web service and a 1 GB persistent disk. Free services are unsuitable for the unattended process and persistent local wallet/database used here.

The Blueprint sets Node 24, one instance, Singapore region, manual deploys, a health check, and persistent data at `/var/data/sol-trader`. It also registers `soltraderbot.com` as the custom domain. It does not change DNS.

Enter secrets into Render's environment fields:

- `TELEGRAM_BOT_TOKEN`: your BotFather token.
- `TELEGRAM_OWNER_ID`: your numeric Telegram user ID.
- Wallet encryption key: enter this in the authenticated Wallet screen after deployment, not in Render environment settings. Existing wallets require their original key; preserve its backup.
- `JUPITER_API_KEY`: your Jupiter key, if available; keyless access is supported at lower limits.

Send a message to your Telegram bot before deploying so it can send its startup message. Keep the service in paper mode. Stop any other instance using the same bot token. If migrating a real wallet, stop its strategy and migrate the encrypted wallet and SQLite state together before trading on the new host. A blank new persistent disk does not contain an existing wallet or position.

Review and approve the displayed price, then deploy. Wait for a successful deployment and check the assigned `https://...onrender.com/healthz` URL returns `{"status":"ok"}`. The app URL must display SOL TRADER, rather than an Apache directory/error page. Trading stays stopped after each restart. The custom-domain origin is already configured, so use the final domain for Telegram controls after DNS is verified.

## 3. Connect soltraderbot.com

Keep the domain registered with its current provider. The current authoritative nameservers are `ns1.stackdns.com` through `ns4.stackdns.com`, so change the DNS zone served by those nameservers (not an unrelated cPanel zone).

In Render, open the service's **Settings → Custom Domains** and copy the exact DNS instructions for `soltraderbot.com`.

At the domain's authoritative DNS manager:

1. Save a copy of the existing records. At preparation time the apex A record was `185.146.167.195`.
2. Change the apex (`@` / `soltraderbot.com`) A record to Render's displayed target. Render's published generic target at preparation time is `216.24.57.1`; verify it against the service dashboard before changing it.
3. If connecting `www`, register it on Render and set its CNAME to the **actual assigned** `...onrender.com` hostname. Do not invent a hostname from the service name.
4. Remove conflicting apex/www AAAA records only for the names being connected, as Render's custom-domain routing uses IPv4.
5. Keep mail records intact. The observed MX target is `mx.stackmail.com`; preserve MX, mail-related A/CNAME records, SPF, DKIM, and DMARC. Nameserver changes are not required.

Click **Verify** in Render and wait for DNS propagation and TLS issuance. Check `https://soltraderbot.com/healthz`, then launch `/app` in Telegram. The service already uses `PUBLIC_APP_URL=https://soltraderbot.com`.

Do not change DNS before the new service has deployed successfully. If cutover fails, restore the recorded previous website DNS values while diagnosing the new service.

## References

- https://render.com/docs/web-services
- https://render.com/docs/disks
- https://render.com/docs/blueprint-spec
- https://render.com/docs/configure-other-dns
- https://render.com/pricing
