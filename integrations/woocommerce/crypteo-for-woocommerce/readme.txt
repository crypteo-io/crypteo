=== Crypteo for WooCommerce ===
Contributors: crypteo
Tags: crypto, non-custodial, bitcoin, usdt, woocommerce
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
WC requires at least: 8.0
WC tested up to: 10.3
Stable tag: 1.0.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Non-custodial crypto payments for WooCommerce. Works with crypteo.io or your own self-hosted Crypteo.

== Description ==

Crypteo is an open source, non-custodial payment gateway. Buyers pay a plain wallet address that belongs to you, not a pooled deposit address, so there is no processor in the middle that can freeze a balance or refuse your business. Crypteo only sees public addresses: no private keys, no seed phrases, no withdrawals to approve.

Use the hosted service at crypteo.io, or run Crypteo on your own server and point the plugin at it. The checkout is white label, so buyers see your shop rather than a payment company.

How it works in your store:

* At checkout the buyer picks "Pay with crypto" and goes to the Crypteo checkout.
* They choose a network (BTC, ETH, SOL, USDC, USDT and more on 10 networks) and pay your wallet directly.
* Crypteo sends a signed webhook on every status change. The plugin checks the signature, reads the payment back from your Crypteo API and only then updates the order.
* Once the payment is paid, the buyer is sent back to your order confirmation page.
* Paid in full (or overpaid) completes the order. A short payment puts it on hold with a note. A checkout that expires with nothing paid marks it failed.

Works with the classic checkout and the block checkout, and with High-Performance Order Storage.

= Things to know =

* Checkouts are priced in US dollars, so the gateway only shows while your store currency is USD.
* Your store must be reachable from the internet for webhooks to arrive.
* A self-hosted instance must be served over https. Plain http is accepted for localhost only, for development.

== Installation ==

1. Install and activate the plugin (WooCommerce must be active).
2. In your Crypteo dashboard, add your receiving wallets under Wallets.
3. Create a key under API keys.
4. Copy the webhook signing secret from Settings, Webhooks.
5. In WordPress go to WooCommerce, Settings, Payments, Crypteo. If you self-host, change the API base URL to your instance's address. Paste the key and the secret, then enable the gateway.

Each payment carries your store's webhook address, so you don't need to add it in your Crypteo settings. The address is shown on the plugin's settings screen if you want to add it as an endpoint anyway.

== Frequently Asked Questions ==

= Do I need a crypteo.io account? =

No. You can use crypteo.io or your own Crypteo instance. Set the API base URL to wherever your Crypteo runs.

= Can I test without real money? =

Yes. Use a key that starts with test_. You can click through the whole checkout and simulate the payment, but test payments never send webhooks, so the order stays pending. Switch to a crypt_ key to go live.

= Who holds the money? =

You do. Buyers pay your wallet addresses directly, and the funds are yours as soon as the transaction confirms.

= What happens if a buyer pays too little? =

The order goes on hold with a note showing what arrived. If the buyer tops up the rest before the session ends, the order completes by itself.

= What if a payment arrives after the checkout expired? =

The order goes on hold for you to review. Late funds are not credited automatically.

= Does the buyer come back to my store after paying? =

Yes. Once the payment is paid, the Crypteo checkout sends the buyer to your order confirmation page. If they leave the checkout or it expires, they land on the order's payment page and can try again. Your confirmation page only shows the order's current status: it never marks anything paid. That only happens through the signed webhook.

== External services ==

This plugin connects to the Crypteo instance set as the API base URL (https://crypteo.io by default) to create payments and read their status. When a buyer chooses Crypteo at checkout, the plugin sends the order total in USD, the order id, number and key, the buyer's billing email, your store's webhook address and the order's confirmation and payment page addresses. When a webhook arrives, the plugin reads that payment back from the same API.

For crypteo.io:
Terms: https://crypteo.io/terms
Privacy policy: https://crypteo.io/privacy

== Changelog ==

= 1.0.0 =
* First release.
