import { createServer } from "node:http";
import { ZodError } from "zod";
import { sendOrderUpdate } from "./receipt_sender.js";

const port = Number(process.env.PORT ?? 3000);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/order-updates") {
    response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await sendOrderUpdate(input);
    response.writeHead(202).end(JSON.stringify({ message_id: result.message_id }));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid order update" }));
      return;
    }
    console.error(error);
    response.writeHead(502).end(JSON.stringify({ error: "Email delivery request failed" }));
  }
});

server.listen(port, () => console.log(`Checkout email service listening on http://localhost:${port}`));
