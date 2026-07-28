import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /health", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("responde 200 con estado ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });
});

describe("rutas no existentes", () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it("responde 404 con formato estándar de error", async () => {
    const response = await app.inject({ method: "GET", url: "/no-existe" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "NOT_FOUND" });
  });
});
