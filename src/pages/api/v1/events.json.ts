import type { APIRoute } from "astro";
import scientificEvents from "../../../data/scientific-events.json";

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(scientificEvents, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
