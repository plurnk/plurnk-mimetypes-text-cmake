import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextCmake from "./TextCmake.ts";

const metadata = {
    mimetype: "text/x-cmake",
    glyph: "🔨",
    extensions: [".cmake", "CMakeLists.txt"] as const,
};

describe("TextCmake — instantiation", () => {
    it("instantiates with metadata", () => {
        const h = new TextCmake(metadata);
        assert.equal(h.mimetype, "text/x-cmake");
        assert.equal(h.glyph, "🔨");
    });
});

describe("TextCmake — extract", () => {
    it("extracts project() as module", () => {
        const h = new TextCmake(metadata);
        const src = "project(MyApp VERSION 1.0 LANGUAGES CXX)";
        const syms = h.extractRaw(src);
        const p = syms.find((s) => s.name === "MyApp");
        assert.ok(p);
        assert.equal(p.kind, "module");
    });

    it("extracts add_executable / add_library as class", () => {
        const h = new TextCmake(metadata);
        const src = [
            "add_executable(my_app main.cpp util.cpp)",
            "add_library(my_lib STATIC lib.cpp)",
        ].join("\n");
        const syms = h.extractRaw(src);
        const exe = syms.find((s) => s.name === "my_app");
        assert.ok(exe);
        assert.equal(exe.kind, "class");
        const lib = syms.find((s) => s.name === "my_lib");
        assert.ok(lib);
        assert.equal(lib.kind, "class");
    });

    it("extracts add_custom_target / add_test as method", () => {
        const h = new TextCmake(metadata);
        const src = [
            "add_custom_target(docs COMMAND make docs)",
            "add_test(NAME unit_tests COMMAND unit_test_runner)",
        ].join("\n");
        const syms = h.extractRaw(src);
        const t = syms.find((s) => s.name === "docs");
        assert.ok(t);
        assert.equal(t.kind, "method");
    });

    it("extracts function() / macro() as function", () => {
        const h = new TextCmake(metadata);
        const src = [
            "function(add_one VAR)",
            "    math(EXPR ${VAR} \"${${VAR}} + 1\")",
            "endfunction()",
            "",
            "macro(say MSG)",
            "    message(STATUS \"${MSG}\")",
            "endmacro()",
        ].join("\n");
        const syms = h.extractRaw(src);
        const f = syms.find((s) => s.name === "add_one");
        assert.ok(f);
        assert.equal(f.kind, "function");
        const m = syms.find((s) => s.name === "say");
        assert.ok(m);
        assert.equal(m.kind, "function");
    });

    it("extracts set() and option() as variable", () => {
        const h = new TextCmake(metadata);
        const src = [
            "set(CMAKE_CXX_STANDARD 20)",
            "set(MY_FLAG ON)",
            "option(ENABLE_TESTS \"Build the tests\" ON)",
        ].join("\n");
        const syms = h.extractRaw(src);
        const std = syms.find((s) => s.name === "CMAKE_CXX_STANDARD");
        assert.ok(std);
        assert.equal(std.kind, "variable");
        const opt = syms.find((s) => s.name === "ENABLE_TESTS");
        assert.ok(opt);
        assert.equal(opt.kind, "variable");
    });

    it("excludes find_package, include, target_*", () => {
        const h = new TextCmake(metadata);
        const src = [
            "find_package(Threads REQUIRED)",
            "include(CTest)",
            "target_link_libraries(my_app PUBLIC mylib)",
            "target_include_directories(my_app PRIVATE include)",
            "add_executable(my_app main.cpp)",
        ].join("\n");
        const syms = h.extractRaw(src);
        const names = syms.map((s) => s.name);
        assert.deepEqual(names, ["my_app"]);
    });

    it("dedupes the same (kind, name) across multiple invocations", () => {
        const h = new TextCmake(metadata);
        const src = [
            "set(MY_FLAG ON)",
            "set(MY_FLAG OFF)",
        ].join("\n");
        const syms = h.extractRaw(src);
        const flags = syms.filter((s) => s.name === "MY_FLAG");
        assert.equal(flags.length, 1);
    });

    it("returns empty array for empty input", () => {
        const h = new TextCmake(metadata);
        assert.deepEqual(h.extractRaw(""), []);
    });

    it("does not throw on malformed source", () => {
        const h = new TextCmake(metadata);
        assert.doesNotThrow(() => h.extractRaw("project( broken"));
        assert.doesNotThrow(() => h.extractRaw("@@ bogus"));
    });
});

describe("TextCmake — framework integration", () => {
    it("renders extracted hierarchy via format()", () => {
        const h = new TextCmake(metadata);
        const out = h.symbolsRaw("project(Hello)");
        assert.ok(out.includes("module Hello"));
    });

    it("inherits jsonpath query against the symbol outline", async () => {
        const h = new TextCmake(metadata);
        const src = "add_executable(my_app main.cpp)";
        const e = await h.query(src, "jsonpath", "$.my_app");
        assert.equal(e.length, 1);
    });
});

// Real-world smoke against a representative CMakeLists.txt.
describe("TextCmake — real-world smoke (typical CMakeLists)", () => {
    const SRC = [
        "cmake_minimum_required(VERSION 3.20)",
        "project(MyApp VERSION 1.0 LANGUAGES CXX)",
        "",
        "set(CMAKE_CXX_STANDARD 20)",
        "set(CMAKE_CXX_STANDARD_REQUIRED ON)",
        "",
        "option(BUILD_TESTS \"Build the test suite\" ON)",
        "option(USE_STATIC_LIBS \"Build static libraries\" OFF)",
        "",
        "find_package(Threads REQUIRED)",
        "find_package(Boost REQUIRED COMPONENTS system filesystem)",
        "",
        "include_directories(include)",
        "",
        "add_library(mylib src/mylib.cpp)",
        "add_library(myutil STATIC src/myutil.cpp)",
        "",
        "add_executable(my_app main.cpp)",
        "target_link_libraries(my_app PRIVATE mylib myutil Threads::Threads Boost::system)",
        "",
        "function(add_compile_options_for_strict_warnings TARGET)",
        "    target_compile_options(${TARGET} PRIVATE -Wall -Wextra -Wpedantic)",
        "endfunction()",
        "",
        "macro(create_test NAME)",
        "    add_executable(${NAME}_test ${NAME}_test.cpp)",
        "endmacro()",
        "",
        "if(BUILD_TESTS)",
        "    add_test(NAME unit_tests COMMAND my_app --test)",
        "endif()",
        "",
        "add_custom_target(format COMMAND clang-format -i src/*.cpp)",
    ].join("\n");

    it("surfaces project, targets, vars, options, functions, custom targets, tests", () => {
        const h = new TextCmake(metadata);
        const syms = h.extractRaw(SRC);
        const names = new Set(syms.map((s) => s.name));

        assert.ok(names.has("MyApp"));
        assert.ok(names.has("CMAKE_CXX_STANDARD"));
        assert.ok(names.has("CMAKE_CXX_STANDARD_REQUIRED"));
        assert.ok(names.has("BUILD_TESTS"));
        assert.ok(names.has("USE_STATIC_LIBS"));
        assert.ok(names.has("mylib"));
        assert.ok(names.has("myutil"));
        assert.ok(names.has("my_app"));
        assert.ok(names.has("add_compile_options_for_strict_warnings"));
        assert.ok(names.has("create_test"));
        assert.ok(names.has("unit_tests"));
        assert.ok(names.has("format"));
    });

    it("kind discrimination", () => {
        const h = new TextCmake(metadata);
        const syms = h.extractRaw(SRC);
        const byNameKind = new Map(syms.map((s) => [`${s.name}:${s.kind}`, s]));
        assert.ok(byNameKind.has("MyApp:module"));
        assert.ok(byNameKind.has("mylib:class"));
        assert.ok(byNameKind.has("my_app:class"));
        assert.ok(byNameKind.has("BUILD_TESTS:variable"));
        assert.ok(byNameKind.has("add_compile_options_for_strict_warnings:function"));
        assert.ok(byNameKind.has("create_test:function"));
        assert.ok(byNameKind.has("unit_tests:method"));
        assert.ok(byNameKind.has("format:method"));
    });
});
