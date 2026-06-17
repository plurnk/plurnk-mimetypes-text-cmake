import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertHandlerConformance } from "@plurnk/plurnk-mimetypes/conformance";
import TextCmake from "./TextCmake.ts";

const metadata = { mimetype: "text/x-cmake", glyph: "🛠", extensions: [".cmake", "CMakeLists.txt"] };
const h = () => new TextCmake(metadata);

const SRC = `cmake_minimum_required(VERSION 3.20)
project(myapp)

add_library(core STATIC core.cpp)
add_library(utils STATIC utils.cpp)

add_executable(app main.cpp)
target_link_libraries(app PRIVATE core utils)
add_dependencies(app core)

# external dependency stays a dead row
target_link_libraries(core PUBLIC Boost::system)
`;

describe("TextCmake — references (build graph)", () => {
    it("target_link_libraries links the target to each library, skipping keywords", () => {
        const refs = h().references(SRC);
        assert.ok(refs.some((r) => r.name === "core" && r.kind === "use" && r.container === "app"));
        assert.ok(refs.some((r) => r.name === "utils" && r.kind === "use" && r.container === "app"));
        assert.ok(!refs.some((r) => r.name === "PRIVATE"), "visibility keyword is not a target");
    });

    it("add_dependencies is a use edge too", () => {
        const refs = h().references(SRC);
        // app → core appears from BOTH target_link_libraries and add_dependencies.
        assert.equal(refs.filter((r) => r.name === "core" && r.container === "app").length, 2);
    });

    it("namespaced external libraries are dead rows (sourced, never joined)", () => {
        const refs = h().references(SRC);
        assert.ok(refs.some((r) => r.name === "Boost::system" && r.container === "core"));
    });

    it("passes the SPEC §16 conformance invariants", async () => {
        await assertHandlerConformance(h(), {
            source: SRC,
            decoyNames: ["external", "dead", "STATIC", "VERSION"],
            expectJoins: [
                { refName: "core", container: "app" },
                { refName: "utils", container: "app" },
            ],
            expectRefs: [
                { name: "core", kind: "use" },
                { name: "utils", kind: "use" },
                { name: "Boost::system", kind: "use" },
            ],
        });
    });
});
