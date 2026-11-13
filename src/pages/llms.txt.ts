import type { APIRoute } from "astro";
import { generateLlmsTxt } from "../domain/agent-egress.mjs";

export const GET: APIRoute = async () => {
  return new Response(generateLlmsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
