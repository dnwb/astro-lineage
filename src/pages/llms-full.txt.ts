import type { APIRoute } from "astro";
import { generateLlmsFullTxt } from "../domain/agent-egress.mjs";

export const GET: APIRoute = async () => {
  return new Response(generateLlmsFullTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
