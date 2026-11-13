import type { APIRoute } from "astro";
import { generateOpenApiYaml } from "../domain/agent-egress.mjs";

export const GET: APIRoute = async () => {
  return new Response(generateOpenApiYaml(), {
    status: 200,
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
