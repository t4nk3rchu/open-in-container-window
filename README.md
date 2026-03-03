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

Works with Bookmark Sidebar Panel

https://github.com/user-attachments/assets/7120ab3b-1250-487e-ab4c-f84cabaa2638


Works with Bookmark Button

https://github.com/user-attachments/assets/f3281295-8c5d-40e1-8916-4925a8589483



## How to Install

1. Install latest version of Sine by following all prompted instructions.
2. Restart Zen Browser.
3. Open settings and go to the "Sine" tab.
4. Locate the Local Installation section.
5. Type t4nk3rchu/open-in-container-window and click Install
6. A popup for restart should appear — click on that to restart Zen.

## Configuration Options

This mod provides preferences that can be adjusted via the Zen Mod Manager (`about:mods`):

- **Replace 'Open in New Window' default behaviour** (Checkbox, Default: `True`): Toggles the smart container auto-detection feature on or off.

## Compatibility
- Designed for **Zen Browser**.
- Fully compatible with the **Context Menu Icons (CMI)** mod. (Icon will align perfectly and use native identity styling). 
- Supports bookmarks triggered from the Bookmarks Toolbar, Places Library, and the Bookmarks Sidebar Panel (`Ctrl+B`).
