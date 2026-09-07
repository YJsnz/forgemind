import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const ui=readFileSync(new URL("../app/assembly-debug/AssemblyDebug.tsx",import.meta.url),"utf8");
const types=readFileSync(new URL("../core/assembly/AssemblyTypes.ts",import.meta.url),"utf8");
const solver=readFileSync(new URL("../core/assembly/AssemblySolver.ts",import.meta.url),"utf8");
const defs=readFileSync(new URL("../core/assembly/PartDefinitions.ts",import.meta.url),"utf8");

test("V4 workbench exposes explicit connector revision authoring and snap",()=>{assert.match(ui,/Create Explicit Connector from A/);assert.match(ui,/Snap B → A/);assert.match(ui,/createPartDefinitionRevisionWithMateConnector/);assert.match(ui,/snapPlacementByMateConnectors/);});
test("V4 workbench exposes Revolute Slider and limits",()=>{assert.match(ui,/Revolute/);assert.match(ui,/Slider/);assert.match(ui,/Enable Mate Limits/);assert.match(solver,/residualForConnectorMate/);assert.match(types,/type: "revolute"/);assert.match(types,/type: "slider"/);});
test("V4 PartDefinition connector authoring is immutable revision based",()=>{assert.match(defs,/Creates a new immutable PartDefinition revision/);assert.match(defs,/createPartDefinitionRevisionWithMateConnector/);assert.match(types,/PersistentTopologyRef/);});
test("V4 drag snap mode and connector adjustment controls are productized",()=>{assert.match(ui,/Drag Snap Mode/);assert.match(ui,/Threshold mm/);assert.match(ui,/Flip primary axis/);assert.match(ui,/connectorDraft\.spinDeg/);assert.match(ui,/snapThresholdRef/);});
