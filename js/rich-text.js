import { sanitizeRichHtml } from "./model.js?v=2026-11-12-03";

const RICH_TEXT_FORMATS = [
  "background",
  "bold",
  "blockquote",
  "code-block",
  "header",
  "italic",
  "link",
  "list",
  "strike",
  "underline",
];

/** Adaptador ligero para usar Quill sin acoplar el modelo a la interfaz. */
export class QuillRichTextEditor {
  constructor(container, toolbar, { placeholder = "", ariaLabel = "Texto enriquecido" } = {}) {
    if (typeof globalThis.Quill !== "function") {
      throw new Error("No se ha podido cargar Quill desde vendor/quill/.");
    }

    this.quill = new globalThis.Quill(container, {
      theme: "snow",
      placeholder,
      formats: RICH_TEXT_FORMATS,
      modules: { toolbar },
    });
    this.root = this.quill.root;
    this.root.setAttribute("role", "textbox");
    this.root.setAttribute("aria-multiline", "true");
    this.root.setAttribute("spellcheck", "true");
    this.root.setAttribute("aria-label", ariaLabel);
    this.root.dir = "auto";
  }

  onChange(handler) {
    this.quill.on("text-change", (_delta, _oldDelta, source) => {
      if (source === "user") handler(this.getHtml());
    });
  }

  setHtml(html = "") {
    const safeHtml = sanitizeRichHtml(html);
    this.quill.setText("", "silent");
    if (safeHtml.trim()) this.quill.clipboard.dangerouslyPasteHTML(0, safeHtml, "silent");
  }

  getHtml() {
    if (!this.quill.getText().trim()) return "";
    return sanitizeRichHtml(this.quill.getSemanticHTML());
  }

  getText() {
    return this.quill.getText().replace(/\n+$/, "");
  }

  setLanguage(lang = "und", dir = "auto") {
    this.root.lang = lang || "und";
    this.root.dir = dir || "auto";
  }

  focus() {
    this.quill.focus();
  }
setEnabled(enabled) {
this.quill.enable(Boolean(enabled));
}
}
