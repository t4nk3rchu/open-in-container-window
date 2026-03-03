---
id: UG-OICW
type: user-guide
status: approved
project: Open-in-Container-Window
owner: "@TankerChu"
tags: [mod, container, bookmarks, zen-browser]
created: 2026-03-03
---

# Open in Container Window

**Open in Container Window** is a mod for the [Zen Browser](https://zen-browser.app/) that deeply integrates native bookmark behavior with Firefox's container tabs and Zen's workspaces. 

It enhances your bookmarking experience by allowing you to launch bookmarks directly into specific container tab environments, either via a manual right-click context menu or completely automatically based on your workspace organization.

## Features

### 1. Manual Container Selection
Adds a new **"Open in New Container Window"** option to your bookmark context menu.
- A dynamically generated submenu displays all your available, color-coded Contextual Identities (Containers).
- Clicking a container opens the selected bookmark in a **new browser window**, securely isolated within that specific container.
- Works across the main browser toolbar, library, and the **sidebar bookmarks panel**.

### 2. Auto-Detect Workspace Containers (Smart Launch)
Replaces the native **"Open in New Window"** bookmark behavior with a smart, container-aware launcher.
- When you click "Open in New Window" on a bookmark, the mod automatically checks if the bookmark (or its parent folder) is assigned to a specific **Zen Workspace**.
- If that workspace has a default container (`containerTabId`), the mod intercepts the click and automatically opens the bookmark in a new window using that container.
- If no workspace container is assigned, it gracefully falls back to the native browser behavior.
- **Toggleable:** This smart behavior can be easily toggled on or off in the Mod Manager settings.

## Demo

[Placeholder: Insert GIF or Video Demo here demonstrating both the submenu and the auto-container behavior]

## How to Install

[Placeholder: Write step-by-step installation instructions for the mod (e.g., placing files, enabling in Sine / Mod Manager, restarting Zen)]

## Configuration Options

This mod provides preferences that can be adjusted via the Zen Mod Manager (`about:mods`):

- **Replace 'Open in New Window' default behaviour** (Checkbox, Default: `True`): Toggles the smart container auto-detection feature on or off.

## Compatibility
- Designed for **Zen Browser**.
- Fully compatible with the **Context Menu Icons (CMI)** mod. (Icon will align perfectly and use native identity styling). 
- Supports bookmarks triggered from the Bookmarks Toolbar, Places Library, and the Bookmarks Sidebar Panel (`Ctrl+B`).
