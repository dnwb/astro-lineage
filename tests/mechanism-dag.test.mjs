import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { projectMechanismDAG } from "../src/domain/academic-domain.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("academic-domain: projectMechanismDAG handles empty or missing physical accounts", () => {
  const empty1 = projectMechanismDAG(null);
  assert.equal(empty1.totalStages, 0);
  assert.equal(empty1.hasBranches, false);
  assert.deepEqual(empty1.levels, []);

  const empty2 = projectMechanismDAG({ stages: [], links: [] });
  assert.equal(empty2.totalStages, 0);
  assert.equal(empty2.hasBranches, false);
  assert.deepEqual(empty2.levels, []);
});

test("academic-domain: projectMechanismDAG calculates topological levels and identifies branching parallel mechanisms", () => {
  // A realistic GRB shock structure:
  // Level 0: Central Engine Energy Reservoir (in-degree 0)
  // Level 1: Launch of Relativistic Shell (driven by engine)
  // Level 2 (Parallel branches):
  //    - Branch A: Forward External Blast Shock
  //    - Branch B: Reverse Internal Shock
  // Level 3: Non-Thermal Synchrotron Radiation (fed by both shocks)
  const physicalAccount = {
    stages: [
      { id: "stage:engine", label: "Central Engine Energy Reservoir", role: "adopted" },
      { id: "stage:ejecta", label: "Relativistic Shell Launch", role: "adopted" },
      { id: "stage:forward-shock", label: "Forward Blast Wave into Ambient ISM", role: "proposed" },
      { id: "stage:reverse-shock", label: "Reverse Shock Heating Ejecta Shell", role: "proposed" },
      { id: "stage:radiation", label: "Broadband Synchrotron Afterglow Radiation", role: "proposed" },
    ],
    links: [
      { source_stage_id: "stage:engine", target_stage_id: "stage:ejecta", relation: "drives", reason: "Poynting-flux or baryonic ejection" },
      { source_stage_id: "stage:ejecta", target_stage_id: "stage:forward-shock", relation: "sweeps", reason: "Ambient medium deceleration at $R_{\\rm dec}$" },
      { source_stage_id: "stage:ejecta", target_stage_id: "stage:reverse-shock", relation: "propagates", reason: "Backward shock wave into unshocked shell" },
      { source_stage_id: "stage:forward-shock", target_stage_id: "stage:radiation", relation: "radiates", reason: "Accelerated electrons cooling via synchrotron" },
      { source_stage_id: "stage:reverse-shock", target_stage_id: "stage:radiation", relation: "radiates", reason: "Optical/radio flash emission" },
    ],
  };

  const dag = projectMechanismDAG(physicalAccount);
  assert.equal(dag.totalStages, 5);
  assert.equal(dag.hasBranches, true);
  assert.equal(dag.levels.length, 4);

  // Level 0: Engine
  assert.equal(dag.levels[0].stages.length, 1);
  assert.equal(dag.levels[0].stages[0].id, "stage:engine");
  assert.equal(dag.levels[0].stages[0].role, "adopted");

  // Level 1: Ejecta
  assert.equal(dag.levels[1].stages.length, 1);
  assert.equal(dag.levels[1].stages[0].id, "stage:ejecta");

  // Level 2: Parallel Branches (Forward and Reverse shocks)
  assert.equal(dag.levels[2].stages.length, 2);
  const branchIds = dag.levels[2].stages.map((s) => s.id);
  assert.ok(branchIds.includes("stage:forward-shock"));
  assert.ok(branchIds.includes("stage:reverse-shock"));
  assert.equal(dag.levels[2].stages[0].role, "proposed");

  // Level 3: Radiation
  assert.equal(dag.levels[3].stages.length, 1);
  assert.equal(dag.levels[3].stages[0].id, "stage:radiation");

  // Links preservation and attachment
  assert.equal(dag.links.length, 5);
  assert.equal(dag.levels[0].stages[0].outgoingLinks.length, 1);
  assert.equal(dag.levels[3].stages[0].incomingLinks.length, 2);
});

test("academic-domain: projectMechanismDAG defaults epistemic roles when not explicitly provided", () => {
  const account = {
    stages: [
      { id: "stage:ambient", label: "Circumstellar Density Profile" }, // in-degree 0 -> adopted
      { id: "stage:cooling", label: "Novel Inelastic Cooling Channel" }, // downstream -> proposed
    ],
    links: [
      { source_stage_id: "stage:ambient", target_stage_id: "stage:cooling", relation: "triggers", reason: "High density trigger" },
    ],
  };

  const dag = projectMechanismDAG(account);
  assert.equal(dag.levels[0].stages[0].role, "adopted");
  assert.equal(dag.levels[1].stages[0].role, "proposed");
});

test("mechanism-dag-component: MechanismDAGStream.astro renders branching cards and epistemic styling", async () => {
  const componentPath = join(projectRoot, "src", "components", "MechanismDAGStream.astro");
  const componentCode = await readFile(componentPath, "utf8");

  // Verifies breakout class for wide horizontal layout
  assert.match(componentCode, /class=["'][^"']*breakout[^"']*["']/u);

  // Verifies epistemic role classes
  assert.match(componentCode, /role-adopted/u);
  assert.match(componentCode, /role-proposed/u);

  // Verifies branch grid layout
  assert.match(componentCode, /class=["'][^"']*mechanism-branch-row[^"']*["']/u);

  // Verifies KaTeX SSOT for causal reasons
  assert.match(componentCode, /renderInlineScientificMarkdownWithMath/u);
});
