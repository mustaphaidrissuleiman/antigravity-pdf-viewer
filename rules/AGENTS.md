# PDF Viewing in Side Panel

Whenever you generate, create, export, build, or reference a PDF file:

1. **Always provide a clickable link to open the PDF directly in the side panel** using the `sidecar://` scheme:
   ```markdown
   [Open <filename>.pdf in Side Panel](sidecar://pdf-viewer/panel/?file=<encoded_path>)
   ```
   *(Pass the absolute path or workspace path in the `?file=` query parameter. If the path contains spaces or parentheses, URL-encode them — e.g. `%20`, `%28`, `%29` — so markdown parsers do not truncate the link).*

2. **Display this link prominently** in your response right after creating or modifying any PDF, allowing the user to click it and inspect the rendered PDF in the side pane immediately.
