import type { Extension } from "@codemirror/state";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

const LANG_LOADERS: Record<string, () => Extension[]> = {
  javascript: () => [javascript({ jsx: true, typescript: false })],
  typescript: () => [javascript({ jsx: true, typescript: true })],
  python: () => [python()],
  java: () => [java()],
  cpp: () => [cpp()],
  rust: () => [rust()],
  html: () => [html()],
  css: () => [css()],
  json: () => [json()],
  markdown: () => [markdown()],
  sql: () => [sql()],
  plaintext: () => [],
};

export const LANGUAGES = [
  { id: "plaintext", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "cpp", label: "C / C++" },
  { id: "rust", label: "Rust" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
  { id: "sql", label: "SQL" },
] as const;

type Props = {
  value: string;
  language: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
};

export function CodeEditor({ value, language, onChange, readOnly }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingRemote = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!hostRef.current) return;

    const langExt = (LANG_LOADERS[language] ?? LANG_LOADERS.plaintext)();

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        ...langExt,
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingRemote.current) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "#0c1117" },
          ".cm-gutters": {
            backgroundColor: "#0c1117",
            borderRight: "1px solid rgba(232, 220, 196, 0.08)",
            color: "#5c6d80",
          },
          ".cm-activeLineGutter": { backgroundColor: "#182231" },
          ".cm-activeLine": { backgroundColor: "rgba(24, 34, 49, 0.7)" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate editor when language / readOnly changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;

    applyingRemote.current = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    applyingRemote.current = false;
  }, [value]);

  return <div className="cm-host" ref={hostRef} />;
}
