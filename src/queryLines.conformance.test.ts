import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextCmake.ts";

// #41: structural matches carry source-line spans (coverage gate).
const h = new Handler({"mimetype":"text/x-cmake","glyph":"🔨","extensions":[".cmake","CMakeLists.txt"]});

describe("#41 query-line conformance", () => {
    it("every structural match carries a source-line span", async () => {
        await assertQueryLineConformance(h, [{ source: "project(p)\nadd_executable(a b.c)\n", dialect: "jsonpath", pattern: "$..*" }]);
    });
});
