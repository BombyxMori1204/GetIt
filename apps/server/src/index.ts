import Fastify from "fastify";

const app = Fastify({ logger: true });

// Временная проверка, что окружение настроено
app.get("/health", async () => ({ ok: true }));

await app.listen({ port: 3000, host: "0.0.0.0" });