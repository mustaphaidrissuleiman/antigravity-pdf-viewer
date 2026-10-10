---
name: pdf-viewer
description: Open and display PDF documents in the side panel. Trigger when the user wants to view, open, preview, or inspect a PDF file.
---

# PDF Viewer in Side Panel

Whenever the user asks to view, open, inspect, or display a PDF document:

1. Surface the clickable sidecar pill to open the PDF in the Auxiliary Side Panel:
   - For a specific file:
     `[Open <filename>.pdf in Side Panel](sidecar://pdf-viewer/panel/?file=<absolute_or_workspace_path>)`
   - For the general PDF Viewer:
     `[Open PDF Viewer](sidecar://pdf-viewer/panel/)`

2. Display the link prominently so the user can open it with a single click.
