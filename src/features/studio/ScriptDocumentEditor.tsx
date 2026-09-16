"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

interface ScriptDocumentEditorProps {
  value: string;
  htmlValue?: string;
  onChange: (value: string, sanitizedHtml: string) => void;
  readOnly?: boolean;
}

const richTokenPattern = /【[^】\n]+】|[“"][^”"\n]+[”"]|[‘'][^’'\n]+[’']/g;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function presentScript(document: string): string {
  let html = "";
  let cursor = 0;

  for (const match of document.matchAll(richTokenPattern)) {
    const start = match.index ?? 0;
    const token = match[0];
    html += escapeHtml(document.slice(cursor, start));
    html += token.startsWith("【")
      ? `<span class="script-document-heading">${escapeHtml(token)}</span>`
      : `<strong class="script-document-emphasis">${escapeHtml(token)}</strong>`;
    cursor = start + token.length;
  }

  return html + escapeHtml(document.slice(cursor));
}

function sanitizeRichHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "FONT", "SPAN", "BR", "DIV", "P"]);

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const fontSize = element.tagName === "FONT" ? Number(element.getAttribute("size")) : null;
    const spanClass = element.tagName === "SPAN" && ["script-document-heading", "script-document-emphasis"].includes(element.className)
      ? element.className
      : "";
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
    if (element.tagName === "FONT") {
      element.setAttribute("size", String(Math.min(7, Math.max(1, fontSize || 3))));
    }
    if (spanClass) element.setAttribute("class", spanClass);
  }

  return template.innerHTML;
}

export function ScriptDocumentEditor({ value, htmlValue = "", onChange, readOnly = false }: ScriptDocumentEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedValue = useRef<string | null>(null);
  const lastEmittedHtml = useRef<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const desiredHtml = htmlValue ? sanitizeRichHtml(htmlValue) : presentScript(value);
    if (value === lastEmittedValue.current && desiredHtml === lastEmittedHtml.current) return;
    editor.innerHTML = desiredHtml;
    lastEmittedValue.current = value;
    lastEmittedHtml.current = desiredHtml;
  }, [htmlValue, value]);

  function emitEditorValue() {
    const editor = editorRef.current;
    if (!editor) return;
    const plainText = editor.innerText;
    const safeHtml = sanitizeRichHtml(editor.innerHTML);
    lastEmittedValue.current = plainText;
    lastEmittedHtml.current = safeHtml;
    onChange(plainText, safeHtml);
  }

  function applyCommand(command: "bold" | "italic" | "underline" | "removeFormat" | "fontSize", value?: string) {
    if (readOnly) return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitEditorValue();
  }

  const toolButton = "rounded border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-col gap-1">
      <label id="full-speaking-script-label" className="text-sm font-medium text-slate-700">
        Full speaking script
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-t-md border border-b-0 border-slate-300 bg-slate-50 px-2 py-2" aria-label="เครื่องมือจัดรูปแบบข้อความ">
        <span className="mr-1 text-xs font-medium text-slate-500">ขนาด</span>
        <button type="button" disabled={readOnly} className={clsx(toolButton, "text-xs")} onMouseDown={(event) => { event.preventDefault(); applyCommand("fontSize", "2"); }} title="ตัวอักษรเล็ก">A−</button>
        <button type="button" disabled={readOnly} className={toolButton} onMouseDown={(event) => { event.preventDefault(); applyCommand("fontSize", "3"); }} title="ตัวอักษรปกติ">A</button>
        <button type="button" disabled={readOnly} className={clsx(toolButton, "text-lg")} onMouseDown={(event) => { event.preventDefault(); applyCommand("fontSize", "5"); }} title="ตัวอักษรใหญ่">A+</button>
        <span className="mx-1 h-6 w-px bg-slate-300" />
        <button type="button" disabled={readOnly} className={clsx(toolButton, "font-bold")} onMouseDown={(event) => { event.preventDefault(); applyCommand("bold"); }} title="ตัวหนา">B</button>
        <button type="button" disabled={readOnly} className={clsx(toolButton, "italic")} onMouseDown={(event) => { event.preventDefault(); applyCommand("italic"); }} title="ตัวเอียง">I</button>
        <button type="button" disabled={readOnly} className={clsx(toolButton, "underline")} onMouseDown={(event) => { event.preventDefault(); applyCommand("underline"); }} title="ขีดเส้นใต้">U</button>
        <button type="button" disabled={readOnly} className={toolButton} onMouseDown={(event) => { event.preventDefault(); applyCommand("removeFormat"); }} title="ล้างรูปแบบ">ล้างรูปแบบ</button>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-labelledby="full-speaking-script-label"
        aria-multiline="true"
        aria-readonly={readOnly}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder="กด ‘สร้างสคริปต์พร้อมพูดด้วย AI’ เพื่อสร้างบทพูดที่มีหัวข้อและลำดับการนำเสนอครบถ้วน"
        onInput={(event) => {
          const nextValue = event.currentTarget.innerText;
          const safeHtml = sanitizeRichHtml(event.currentTarget.innerHTML);
          lastEmittedValue.current = nextValue;
          lastEmittedHtml.current = safeHtml;
          onChange(nextValue, safeHtml);
        }}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          emitEditorValue();
        }}
        onBlur={(event) => {
          const plainText = event.currentTarget.innerText;
          const safeHtml = sanitizeRichHtml(event.currentTarget.innerHTML);
          event.currentTarget.innerHTML = safeHtml;
          lastEmittedValue.current = plainText;
          lastEmittedHtml.current = safeHtml;
        }}
        className={clsx(
          "script-document-editor min-h-[640px] w-full whitespace-pre-wrap rounded-b-md border border-slate-300 bg-white px-5 py-4 text-[15px] leading-7 text-slate-800",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
          "empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]",
          readOnly && "cursor-not-allowed bg-slate-50 opacity-70"
        )}
      />
      <p className="text-xs text-slate-500">
        เลือกข้อความแล้วใช้แถบเครื่องมือเพื่อปรับขนาด ตัวหนา ตัวเอียง หรือขีดเส้นใต้ รูปแบบที่เลือกจะถูกบันทึกพร้อม Draft
      </p>
      <style jsx global>{`
        .script-document-heading {
          display: inline-block;
          margin-top: 0.85rem;
          border-radius: 0.375rem;
          background: rgb(239 246 255);
          padding: 0.2rem 0.55rem;
          color: rgb(30 64 175);
          font-size: 1.05rem;
          font-weight: 700;
          line-height: 1.75rem;
        }
        .script-document-editor .script-document-heading:first-child {
          margin-top: 0;
        }
        .script-document-emphasis {
          color: rgb(15 23 42);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
