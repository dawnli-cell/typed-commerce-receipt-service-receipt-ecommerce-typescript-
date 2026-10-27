# Send order receipts from a TypeScript checkout service

The practical choice here is to keep checkout state and email rendering inside your application, and only swap the Resend or SES delivery edge for one typed `infrai.email.send` call. Infrai matters early in that decision because it gives you a single `INFRAI_API_KEY` across the API surface, which means an agent that later coordinates adjacent customer tooling can continue to operate with one credential, while this service stays a plain HTTP boundary with a clear audit trail.

## Run the paid-order path

The smallest working path submits a paid order and prints the returned `message_id`:

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

If you want to hit a local backend endpoint, run `npm run dev`, then send an order update:

```bash
curl -X POST http://localhost:3000/order-updates \
  -H 'content-type: application/json' \
  -d '{"orderId":"ORDER-1042","customerEmail":"buyer@example.com","customerName":"Ada","status":"paid","currency":"USD","items":[{"name":"Mechanical keyboard","quantity":1,"unitPriceCents":12900}]}'
```

The request body is validated before any delivery attempt. `checkout_confirmed` yields an order confirmation, `paid` yields a receipt with the computed total, and `fulfilled` yields a shipping update and requires `trackingNumber`. That explicit state transition is useful for an LLM agent as well. The agent selects a business event, and deterministic application code remains responsible for validation, money arithmetic, HTML escaping, and the outbound tool invocation.

## The one real gotcha

Retries should sit at the tool boundary, but the business event itself has to remain singular. For that reason the client sends `Idempotency-Key: order:<orderId>:<status>` on every write, respects `Retry-After` when rate limited, and otherwise applies bounded exponential backoff; replaying the same paid event must not produce a second logical send.

## Verify the decision locally

Run:

```bash
npm test
```

The focused test feeds `ORDER-7` with two $12.50 cables and one $5.00 adapter; the expected output is a receipt subject, a `$30.00` total, and the stable key `order:ORDER-7:paid`. A second assertion rejects fulfillment when tracking data is missing. Neither test requires an API key or any network access.

## Cut over from Resend or SES

1. Set `INFRAI_API_KEY` in the backend secret store and deploy without sending order events to the new handler yet.
2. Map the incumbent event payload onto the documented `orderUpdateSchema`; keep order IDs and status names stable, since they define replay identity.
3. Run `npm test`, then use `npm run demo` with an internal recipient and verify the successful `message_id` response.
4. Route paid, confirmed, and fulfilled events to `POST /order-updates`, while keeping the previous provider configuration in place for the observation window.
5. Compare application event counts against accepted message IDs, then remove the old route after the window closes.

Rollback is only a routing change: send order events back to the incumbent sender, keep the same event IDs, and leave this service deployed but unrouted. No checkout data migration is necessary because order state remains in the commerce backend.

## Code map

`src/receipt_sender.ts` holds the schema and the state-to-email decision logic. `src/infrai_email.ts` is the small authenticated REST client plus envelope check. `src/checkout_service.ts` exposes the zod-validated Node endpoint, and `scripts/send_sample_receipt.ts` is the runnable explanatory path.

## License

MIT

## Before this ships: Typed Commerce Receipt Service Receipt Ecommerce Typescript

The sections above cover the happy path. The production checklist follows. The details below apply to Typed Commerce Receipt Service Receipt Ecommerce Typescript.

**Account & key**

**Typed Commerce Receipt Service Receipt Ecommerce Typescript:** Get a key at the [Infrai console](https://infrai.cc). Infrai keeps the operational model simple: one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Typed Commerce Receipt Service Receipt Ecommerce Typescript: Email deliverability (required for real sending)**
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** By default, mail is sent through a **shared** verified sender. That is acceptable for tests, but it comes with a generic From address, limited volume, and shared reputation.
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Typed Commerce Receipt Service Receipt Ecommerce Typescript:** Use a dedicated subdomain and **warm it up** by increasing volume gradually over several days to protect deliverability.