# PDF Viewer UI Extension for Antigravity

An interactive visual PDF reader that renders directly in the Antigravity 2.0 side panel (Auxiliary Pane).

![PDF Viewer Logo](assets/logo.svg)

## Features

- **Side Panel Integration:** Renders smoothly in the right-hand auxiliary pane alongside your conversations.
- **File Loading:** Open any local PDF via file dialog, drag-and-drop, or quick-select from your active workspace.
- **Workspace Discovery:** Automatically detects and indexes `.pdf` files inside open workspace project folders.
- **Viewer Controls:**
  - Previous / Next page navigation and direct page jumping
  - High-DPI / Retina-crisp rendering
  - Zoom controls: Zoom In, Zoom Out, and Fit to Width
  - Single Page and Continuous Vertical Scroll view modes
- **Ask Agent:** One-click button to send the document to Antigravity for instant summarization and analysis.
- **Self-Contained & Offline:** Bundles PDF.js locally with zero external network or CDN dependencies.

## Installation

### Method 1: Global User Plugin (Recommended)

Clone or copy this repository into your Antigravity plugins directory:

- **macOS / Linux:**
  ```bash
  git clone <repo-url> ~/.gemini/config/plugins/pdf-viewer
  ```
- **Windows (PowerShell):**
  ```powershell
  git clone <repo-url> "$env:USERPROFILE\.gemini\config\plugins\pdf-viewer"
  ```

### Method 2: Project / Team Workspace Customization

To share the viewer automatically with team members in a specific project or Git repository, copy the folder to `.agents/plugins/`:

```bash
mkdir -p .agents/plugins
cp -r /path/to/pdf-viewer .agents/plugins/pdf-viewer
git add .agents/plugins/pdf-viewer
git commit -m "Add Antigravity PDF Viewer extension"
```

Anyone opening this workspace will have the extension available automatically.

## Usage

1. Open Antigravity and go to **Customizations > Installed** in the left sidebar.
2. Ensure **PDF Viewer** is enabled.
3. In any conversation, click the **⋮** menu in the top-right corner, select **Extensions**, and choose **PDF Viewer**.
4. Or open it via deep-link: `[Open PDF Viewer](sidecar://pdf-viewer/panel/)`.

## License

MIT
