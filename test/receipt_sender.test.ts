import assert from "node:assert/strict";
import test from "node:test";
import { orderUpdateSchema, prepareOrderEmail } from "../src/receipt_sender.js";

test("a paid checkout becomes a receipt with the calculated total", () => {
  const order = orderUpdateSchema.parse({
    orderId: "ORDER-7",
    customerEmail: "buyer@example.com",
    customerName: "Lin",
    status: "paid",
    currency: "USD",
    items: [
      { name: "Cable", quantity: 2, unitPriceCents: 1250 },
      { name: "Adapter", quantity: 1, unitPriceCents: 500 }
    ]
  });

  const email = prepareOrderEmail(order);
  assert.equal(email.subject, "Receipt for order ORDER-7");
  assert.match(email.html, /\$30\.00/);
  assert.equal(email.idempotencyKey, "order:ORDER-7:paid");
});

test("fulfillment requires a tracking number", () => {
  const result = orderUpdateSchema.safeParse({
    orderId: "ORDER-8",
    customerEmail: "buyer@example.com",
    customerName: "Lin",
    status: "fulfilled",
    currency: "USD",
    items: [{ name: "Cable", quantity: 1, unitPriceCents: 1250 }]
  });
  assert.equal(result.success, false);
});
