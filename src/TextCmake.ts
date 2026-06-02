import { AntlrExtractor, withExtractor } from "@plurnk/plurnk-mimetypes";
import type { ExtractionVisitor } from "@plurnk/plurnk-mimetypes";
import { CharStream, CommonTokenStream } from "antlr4ng";
import { CMakeLexer } from "./generated/CMakeLexer.ts";
import { CMakeParser } from "./generated/CMakeParser.ts";
import { CMakeVisitor } from "./generated/CMakeVisitor.ts";

// text/x-cmake handler. ANTLR grammar from grammars-v4/cmake.
//
// Parser entry rule: file_ → command_invocation* EOF.
//
// CMake is a sequence of command invocations: `command(arg1 arg2 ...)`.
// The "declarations" are conventional: project(...), add_executable(...),
// add_library(...), function(...), macro(...), set(...), option(...).
// We dispatch on the command name and surface the first relevant argument
// as the declared name.
export default class TextCmake extends AntlrExtractor {
    protected parseTree(content: string): unknown {
        const lexer = new CMakeLexer(CharStream.fromString(content));
        const tokens = new CommonTokenStream(lexer);
        const parser = new CMakeParser(tokens);
        parser.removeErrorListeners();
        return parser.file_();
    }

    protected createVisitor(): ExtractionVisitor {
        return new TextCmakeVisitor() as unknown as ExtractionVisitor;
    }
}

// SPEC §3 mapping for CMake:
//   project(name ...)              → module
//   add_executable(name ...)       → class
//   add_library(name ...)          → class
//   add_custom_target(name ...)    → method
//   add_test(name ...)             → method
//   function(name ...)             → function
//   macro(name ...)                → function
//   set(var ...)                   → variable
//   option(name doc default)       → variable
//   find_package(name ...)         → excluded (dependency)
//   include(...) / include_directories(...) → excluded
//   target_link_libraries / target_include_directories / target_compile_*
//                                   → excluded (configuration of an existing target)
class TextCmakeVisitor extends withExtractor(CMakeVisitor) {
    #emittedKeys = new Set<string>();

    visitCommand_invocation = (ctx: any): null => {
        if (this.inBody) return null;
        const idTok = ctx.Identifier?.();
        if (!idTok) return null;
        const cmd = idTok.getText?.()?.toLowerCase?.();
        if (!cmd) return null;

        const firstArg = firstArgumentText(ctx);

        switch (cmd) {
            case "project":
                if (firstArg) this.emit("module", firstArg, ctx);
                return null;
            case "add_executable":
            case "add_library":
                if (firstArg) this.emit("class", firstArg, ctx);
                return null;
            case "add_custom_target":
                if (firstArg) this.emit("method", firstArg, ctx);
                return null;
            case "add_test": {
                // add_test has two forms:
                //   add_test(testName command arg1 ...)        — first arg is name
                //   add_test(NAME testName COMMAND command ...) — NAME keyword form
                if (!firstArg) return null;
                if (firstArg.toUpperCase() === "NAME") {
                    const second = nthArgumentText(ctx, 1);
                    if (second) this.emit("method", second, ctx);
                } else {
                    this.emit("method", firstArg, ctx);
                }
                return null;
            }
            case "function":
            case "macro":
                if (firstArg) this.emit("function", firstArg, ctx);
                return null;
            case "set":
            case "option":
                if (firstArg) this.emit("variable", firstArg, ctx);
                return null;
            default:
                return null;
        }
    };

    private emit(kind: "class" | "module" | "method" | "function" | "variable", name: string, ctx: any): void {
        const key = `${kind}:${name}`;
        if (this.#emittedKeys.has(key)) return;
        this.#emittedKeys.add(key);
        this.addSymbol(kind, name, ctx);
    }
}

// command_invocation: Identifier '(' (single_argument | compound_argument)* ')'
// We want the FIRST single_argument's text (or descend through the first
// compound_argument if that's the leading form).
function firstArgumentText(ctx: unknown): string | null {
    const node = ctx as {
        single_argument?: () => Array<unknown> | unknown;
        compound_argument?: () => Array<unknown> | unknown;
    };
    const rawSingle = node.single_argument?.();
    const singleArr = Array.isArray(rawSingle) ? rawSingle : rawSingle ? [rawSingle] : [];
    if (singleArr.length > 0) {
        const t = (singleArr[0] as { getText?: () => string }).getText?.();
        if (t) return stripQuotes(t);
    }
    const rawCompound = node.compound_argument?.();
    const compoundArr = Array.isArray(rawCompound) ? rawCompound : rawCompound ? [rawCompound] : [];
    if (compoundArr.length > 0) {
        const t = (compoundArr[0] as { getText?: () => string }).getText?.();
        if (t) return stripQuotes(t);
    }
    return null;
}

function stripQuotes(s: string): string {
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    return s;
}

function nthArgumentText(ctx: unknown, n: number): string | null {
    const node = ctx as { single_argument?: () => Array<unknown> | unknown };
    const raw = node.single_argument?.();
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const item = arr[n];
    if (!item) return null;
    const t = (item as { getText?: () => string }).getText?.();
    return t ? stripQuotes(t) : null;
}
