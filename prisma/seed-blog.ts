// Sample blog posts for local and staging databases (prisma/seed.ts seeds
// them outside production only). Plain data: no Prisma import, so the seed
// and one-off scripts can both use it.

export const SAMPLE_BLOG_POSTS = [
  {
    slug: "why-you-should-receive-crypto-payments-in-a-self-custody-wallet",
    title: "Why you should receive crypto payments in a self-custody wallet",
    excerpt:
      "An exchange deposit address looks like a convenient place to get paid. For a store it's the wrong one: deposits can be held, questioned or refused. Here's why a wallet you control is the better destination.",
    publishedAt: new Date("2026-10-06T09:00:00Z"),
    content: `When you start accepting crypto, the quickest address to hand is often the one your exchange shows under "Deposit". It works, in the sense that coins arrive. But an exchange account was built for trading your own money, not for receiving a stream of payments from strangers, and that difference shows up quickly.

## What happens when payments land on an exchange

Exchanges are regulated businesses, and they screen incoming transfers. Each deposit is checked against where it came from, and some exchanges ask you to explain transfers they can't place. Nexo, for example, holds deposits and asks for information about individual transactions: who sent it, what it was for, how you know the sender.

For a person moving their own savings that's a minor chore. For a store it means:

- **Payments you can't use yet.** A held deposit is money your customer has already paid and you can't spend, sometimes for days.
- **Questions you may not be able to answer.** You often know the order number, not the buyer's wallet history. If the exchange isn't satisfied, the deposit can be returned or the account restricted.
- **A third party deciding.** Your ability to get paid depends on another company's risk team, which is exactly what accepting crypto was supposed to avoid.

There is also a quieter problem. Deposit addresses can change, be retired, or stop supporting a network. A buyer who pays an old address may not be credited at all.

## What a self-custody wallet changes

A self-custody (non-custodial) wallet is one where you hold the keys: Base Wallet, Trust Wallet and similar apps. The address belongs to you, not to an account at a company. When a buyer pays it:

- The payment is yours as soon as the network confirms it. Nobody reviews it first.
- Nobody can hold, reverse or freeze it, because no one else has the keys.
- The address stays the same until you decide otherwise.

It also helps the buyer. Many buyers pay from their own exchange account. To that exchange, a payment to your wallet is an ordinary withdrawal to a personal address, not a transfer to a payment company it may have decided not to deal with.

## The trade-off: you hold the keys

Self-custody puts the responsibility on you. A few habits cover most of it:

1. **Write the recovery phrase down offline** and store it somewhere safe. Anyone with it can take the funds, and without it you can't recover the wallet.
2. **Never type the phrase into a website**, and never share it with anyone, including support staff. No legitimate service needs it. Crypteo never asks for it: it only ever sees your public addresses.
3. **Send a small test payment** to each new address before you publish it.
4. **Move larger balances** to a hardware wallet if your volume grows.

## Can I still use my exchange?

Yes, for what exchanges are good at. Receive payments into your own wallet, then send what you want to convert to your exchange yourself, when it suits you. That transfer comes from a wallet you control and can explain in one line, rather than from dozens of buyers you can't.

## How Crypteo fits in

Crypteo is non-custodial. You add your wallet's receiving addresses, buyers pay those addresses directly, and Crypteo watches the chain and tells your store when a payment arrives. There is no balance held with us and nothing to withdraw. If you're ready to set it up, [create an account](/register) and add your first address.`,
  },
  {
    slug: "what-non-custodial-actually-means-for-your-store",
    title: "What 'non-custodial' actually means for your store",
    excerpt:
      "Non-custodial is a word every crypto payment service uses. Here's what it should mean in practice, what it changes for your store, and the questions to ask any provider that claims it.",
    publishedAt: new Date("2026-10-09T09:00:00Z"),
    content: `"Non-custodial" turns up in nearly every crypto payment pitch, often without an explanation. It has a precise meaning, and it's worth knowing, because it decides who can stop you getting paid.

## Custodial vs non-custodial

A **custodial** payment service receives the buyer's crypto into addresses it controls. Your money sits in its pooled wallets, and you see a balance on its dashboard. To get paid you request a withdrawal or a payout, which the provider approves and sends.

A **non-custodial** service never holds the money. The buyer pays an address that belongs to you, and the funds arrive in your wallet directly. The service only handles the parts around the payment: generating the checkout, watching the blockchain, and notifying you.

The simplest test: *if the provider vanished tomorrow, would any of your money vanish with it?* With a non-custodial service, no. Nothing was ever there.

## What changes for your store

**Nobody can freeze your balance.** There is no balance held for you. A custodial provider can pause payouts while it reviews your account, apply a reserve, or close the account with funds still inside. Without custody, none of those levers exist.

**Payments are final when the network says so.** Once the transaction confirms, the coins are in your wallet. There's no settlement delay and no payout schedule.

**Buyers' exchanges see an ordinary withdrawal.** Some exchanges restrict transfers to payment platforms. A payment to your own address looks like any personal withdrawal, so it's less likely to be blocked on the buyer's side.

**You keep the security responsibility.** If you lose your wallet's recovery phrase, nobody can restore it. That's the cost of nobody being able to take it either.

## What it doesn't mean

Non-custodial doesn't mean "no rules". You remain responsible for your own tax and reporting obligations. And it doesn't make every payment perfect: buyers can still send the wrong amount, use the wrong network, or pay after the checkout expired. A good service detects those cases and reports them so you can resolve them with the buyer.

## Questions to ask a provider

- **Where do buyers' payments go?** The answer should be "to addresses you supplied", not "to our wallet".
- **Do you ever ask for a private key or recovery phrase?** The only correct answer is no.
- **Is there a withdrawal or payout step?** If there is, the provider is holding your money in between.
- **How are fees charged?** If fees are deducted from your balance, someone is holding a balance.

## How Crypteo works

Crypteo is non-custodial. You paste the receiving addresses from your own wallet, such as Base Wallet or Trust Wallet. Buyers pay those addresses on a hosted checkout or through the API, Crypteo matches each on-chain payment to its order, and your backend gets a signed webhook. We only see public addresses: no keys, no balances, no payouts to approve. [Start accepting crypto](/register) when you're ready.`,
  },
];
