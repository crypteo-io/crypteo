=== Crypto Payment Gateway for WooCommerce (by Crypteo) ===
Contributors: crypteo
Tags: crypto payment gateway, bitcoin, usdt, woocommerce, cryptocurrency
Requires at least: 6.2
Tested up to: 6.8
Requires PHP: 7.4
WC requires at least: 8.0
WC tested up to: 10.3
Stable tag: 1.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Take Bitcoin, USDT, USDC and ETH in WooCommerce on your own checkout page, paid straight to your wallet. Non-custodial and open source.

== Description ==

This plugin adds a crypto payment gateway to WooCommerce without handing your money to a processor. Buyers pay your own wallet address, Crypteo watches the chain, and the order updates when the payment confirms. There is no account approval and no KYC, and nobody can freeze a balance, because there is no balance held anywhere.

The checkout can stay on your store. After placing an order the buyer picks a coin on your own order page, sees the address, amount and QR code there, and lands on your thank-you page once it's paid. If you prefer, switch to the hosted checkout, a white label page with your logo and colours that can run on your own domain.

Accepted coins: Bitcoin, Ethereum, USDC and USDT on several networks, Solana, BNB, Polygon, Tron, XRP, Dogecoin, Zcash and Cardano. You only offer the ones you've added a wallet for.

Fees are low and tiered by monthly volume, and you can avoid them entirely: Crypteo is open source, so you can self-host it on your own server and point this plugin at your instance with one setting. See [crypteo.io](https://crypteo.io) for pricing and the source code.

How it works in your store:

* The buyer chooses "Pay with crypto" and places the order.
* They pay from any wallet or exchange, on your site or on the hosted checkout.
* Crypteo sends a signed webhook to your store on every status change. The plugin checks the signature, reads the payment back from the Crypteo API and updates the order. It never takes the webhook's word for money.
* Paid in full (or overpaid) completes the order. A short payment puts it on hold with a note. A checkout that expires with nothing paid marks it failed.

Works with the classic checkout and the block checkout, and with High-Performance Order Storage.

= Things to know =

* Checkouts are priced in US dollars, so the gateway only shows while your store currency is USD.
* Your store must be reachable from the internet for webhooks to arrive. A site on localhost won't receive them.
* Self-hosting? Set the API base URL to your own Crypteo. It must use https (plain http is only allowed for localhost). The source code is at https://github.com/crypteo-io/crypteo.

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

= Can the checkout stay on my WordPress site? =

Yes, that's the default. Buyers choose a coin and pay on your order page, so they never leave your store. Under Checkout in the plugin settings you can switch to the hosted page instead.

= Does the buyer come back to my store after paying? =

Yes. On the hosted checkout, once the payment is paid the buyer is sent to your order confirmation page. If they leave the checkout or it expires, they land on the order's payment page and can try again. Your confirmation page only shows the order's current status: it never marks anything paid. That only happens through the signed webhook.

== External services ==

This plugin connects to the Crypteo instance set as the API base URL (https://crypteo.io by default) to create payments and read their status. When a buyer chooses Crypteo at checkout, the plugin sends the order total in USD, the order id, number and key, the buyer's billing email, your store's webhook address and the order's confirmation and payment page addresses. While a buyer pays on your site, the plugin reads the payment's status from the same API and sends the coin they picked. When a webhook arrives, the plugin reads that payment back from the same API.

For crypteo.io:
Terms: https://crypteo.io/terms
Privacy policy: https://crypteo.io/privacy

== Third-party libraries ==

assets/js/qrcode.js is qrcode-generator 1.4.4 by Kazuhiko Arase, MIT licence (https://github.com/kazuhikoarase/qrcode-generator). It draws the payment QR code in the buyer's browser.

== Changelog ==

= 1.1.0 =
* The checkout can now stay on your site, and does by default.
* New plugin name and description.

= 1.0.0 =
* First release.
