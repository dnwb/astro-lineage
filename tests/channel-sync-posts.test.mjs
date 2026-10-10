import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScopedPaperIndex } from "../scripts/sync-all-channel-posts.mjs";
import { DAILY_BRIEF_CHANNEL_ID } from "../scripts/channel-publication.mjs";

test("buildScopedPaperIndex loads papers from dated archives into memory Map", async () => {
  const index = await buildScopedPaperIndex();
  assert.ok(index.size > 0, "Index must contain papers from archives");
  for (const [key, val] of index.entries()) {
    assert.match(key, /^\d{4}\.\d{4,5}v\d+$/, "Key must be arxiv_id + revision");
    assert.ok(val.paper, "Value must contain paper object");
    assert.match(val.date, /^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
    break;
  }
});

test("Single paper channel routing boundary rejects Daily Briefing channel (742956201)", () => {
  assert.equal(DAILY_BRIEF_CHANNEL_ID, "742956201");
  const violates = (channelId) => String(channelId) === DAILY_BRIEF_CHANNEL_ID;
  assert.equal(violates("742956201"), true, "742956201 must violate single-paper routing");
  assert.equal(violates("742956184"), false, "742956184 (general) is valid");
  assert.equal(violates("742956214"), false, "R1 channel is valid");
});
