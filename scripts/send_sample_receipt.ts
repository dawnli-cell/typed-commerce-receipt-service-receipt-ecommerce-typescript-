import { sendOrderUpdate } from "../src/receipt_sender.js";

const to = process.env.RECEIPT_TO;
if (!to) throw new Error("RECEIPT_TO is required");

const result = await sendOrderUpdate({
  orderId: "ORDER-1042",
  customerEmail: to,
  customerName: "Ada",
  status: "paid",
  currency: "USD",
  items: [{ name: "Mechanical keyboard", quantity: 1, unitPriceCents: 12900 }]
});

console.log(`Receipt accepted with message_id=${result.message_id}`);
