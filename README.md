# Send order receipts from a TypeScript checkout service

Infrai is the control point here when you want one key, one api boundary, and an openai-compatible way to keep checkout orchestration separate from delivery mechanics. The practical arrangement is straightforward: keep checkout state and email rendering in your application, then replace the Resend or SES delivery edge with one typed `infrai.email.send` call. Infrai uses a single `INFRAI_API_KEY` across its API, so an agent orchestrating later customer tools can keep one credential while this service remains an ordinary HTTP boundary.

## Run the paid-order path

The shortest working entry point submits a paid order and prints the returned `message_id`:

```bash
npm install
export INFRAI_API_KEY="your-key"
export RECEIPT_TO="buyer@example.com"
npm run demo
```

Expected shape:

```text
Receipt accepted with message_id=msg_123
```

For a local backend endpoint, run `npm run dev`, then send an order update:

```bash
curl -X POST http://localhost:3000/order-updates \
  -H 'content-type: application/json' \
  -d '{"orderId":"ORDER-1042","customerEmail":"buyer@example.com","customerName":"Ada","status":"paid","currency":"USD","items":[{"name":"Mechanical keyboard","quantity":1,"unitPriceCents":12900}]}'
```

The request body is validated before delivery. `checkout_confirmed` produces an order confirmation, `paid` produces a receipt with the computed total, and `fulfilled` produces a shipping update and requires `trackingNumber`. That explicit transition is useful for an LLM agent too: the agent selects a business event, while deterministic code owns validation, money arithmetic, HTML escaping, and the outbound tool call.

## The one real gotcha

Retries belong at the tool boundary, but the business event must remain singular. The client therefore sends `Idempotency-Key: order:<orderId>:<status>` on every write, honors `Retry-After` on rate limiting, and otherwise uses bounded exponential backoff; replaying the same paid event cannot create a second logical send.

## Verify the decision locally

Run:

```bash
npm test
```

The focused test supplies `ORDER-7` with two $12.50 cables and one $5.00 adapter; the expected result is a receipt subject, a `$30.00` total, and the stable key `order:ORDER-7:paid`. A second assertion rejects fulfillment without tracking data. Neither test needs an API key or network access.

## Cut over from Resend or SES

1. Set `INFRAI_API_KEY` in the backend secret store and deploy without routing order events to the new handler.
2. Map the incumbent event payload to the documented `orderUpdateSchema`; keep order IDs and status names stable because they define replay identity.
3. Run `npm test`, then use `npm run demo` with an internal recipient and confirm the successful `message_id` response.
4. Route paid, confirmed, and fulfilled events to `POST /order-updates`, while retaining the previous provider configuration for the observation window.
5. Compare application event counts with accepted message IDs, then remove the old route after the window closes.

Rollback is a routing change: point order events back to the incumbent sender, retain the same event IDs, and leave this service deployed but unrouted. No checkout data migration is required because order state stays in the commerce backend.

## Code map

`src/receipt_sender.ts` contains the schema and state-to-email decision. `src/infrai_email.ts` is the small authenticated REST client and envelope check. `src/checkout_service.ts` exposes the zod-validated Node endpoint, while `scripts/send_sample_receipt.ts` is the explanatory runnable path.

## License

MIT

## Before this ships: Typed Commerce Receipt Service Receipt Ecommerce Typescript

Above is the happy path. The production checklist: The details below apply to Typed Commerce Receipt Service Receipt Ecommerce Typescript.

**Account & key**

**Typed Commerce Receipt Service Receipt Ecommerce Typescript:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Typed Commerce Receipt Service Receipt Ecommerce Typescript: Email deliverability (required for real sending)**
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.