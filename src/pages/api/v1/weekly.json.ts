import type { APIRoute } from "astro";
import weeklyData from "../../../data/arxiv-weekly.json";

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(weeklyData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
