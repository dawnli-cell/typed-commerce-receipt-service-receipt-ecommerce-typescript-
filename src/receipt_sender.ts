import { z } from "zod";
import { infrai, type SendEmailResult } from "./infrai_email.js";

const lineItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative()
});

export const orderUpdateSchema = z.object({
  orderId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  status: z.enum(["checkout_confirmed", "fulfilled", "paid"]),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  items: z.array(lineItemSchema).min(1),
  trackingNumber: z.string().min(1).optional()
}).superRefine((order, context) => {
  if (order.status === "fulfilled" && !order.trackingNumber) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["trackingNumber"], message: "required for fulfilled orders" });
  }
});

export type OrderUpdate = z.infer<typeof orderUpdateSchema>;
export type PreparedOrderEmail = { to: string; subject: string; html: string; idempotencyKey: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
})[character] as string);

export function prepareOrderEmail(order: OrderUpdate): PreparedOrderEmail {
  const totalCents = order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: order.currency }).format(totalCents / 100);
  const rows = order.items.map((item) => `<li>${escapeHtml(item.name)} x ${item.quantity}</li>`).join("");

  if (order.status === "fulfilled") {
    return {
      to: order.customerEmail,
      subject: `Order ${order.orderId} has shipped`,
      html: `<h1>Your order is on its way</h1><p>Hi ${escapeHtml(order.customerName)}, tracking number: ${escapeHtml(order.trackingNumber!)}</p><ul>${rows}</ul>`,
      idempotencyKey: `order:${order.orderId}:fulfilled`
    };
  }

  const paid = order.status === "paid";
  return {
    to: order.customerEmail,
    subject: paid ? `Receipt for order ${order.orderId}` : `Order ${order.orderId} confirmed`,
    html: `<h1>${paid ? "Payment receipt" : "Order confirmed"}</h1><p>Hi ${escapeHtml(order.customerName)}, your total is ${amount}.</p><ul>${rows}</ul>`,
    idempotencyKey: `order:${order.orderId}:${order.status}`
  };
}

export async function sendOrderUpdate(input: unknown): Promise<SendEmailResult> {
  const email = prepareOrderEmail(orderUpdateSchema.parse(input));
  return infrai.email.send({ to: email.to, subject: email.subject, html: email.html }, email.idempotencyKey);
}
