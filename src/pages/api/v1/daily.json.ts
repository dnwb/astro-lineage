import type { APIRoute } from "astro";
import dailyFeed from "../../../data/arxiv-daily.json";
import dailyRadar from "../../../data/daily-radar.json";
import { validateDailyRadarPayload } from "../../../../scripts/daily-radar.mjs";

export const GET: APIRoute = async () => {
  const validation = validateDailyRadarPayload(dailyFeed, dailyRadar);
  const payload = {
    schema_version: "astrolineage-api-v1",
    generated_at: new Date().toISOString(),
    edition: validation.model.edition,
    opening_brief: validation.model.opening_brief,
    counts: validation.model.counts,
    groups: {
      must_read: validation.model.groups.must_read,
      worth_knowing: validation.model.groups.worth_knowing,
      skip: validation.model.groups.skip,
    },
    knowledge_points: validation.model.knowledge_points,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
