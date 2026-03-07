(function () {
  "use strict";

  // ─── Preference Keys ────────────────────────────────────────────
  const PREF_AUTO_CONTAINER = "extensions.openInContainerWindow.autoContainerWindowInBookmark";
  const PREF_AUTO_CONTAINER_GLOBAL = "extensions.openInContainerWindow.3";

  // ─── Helpers ────────────────────────────────────────────────────
  const getPref = (key, fallback) => {
    try {
      const svc = Services.prefs;
      if (svc.prefHasUserValue(key)) {
        switch (svc.getPrefType(key)) {
          case svc.PREF_STRING:
            return svc.getStringPref(key);
          case svc.PREF_INT:
            return svc.getIntPref(key);
          case svc.PREF_BOOL:
            return svc.getBoolPref(key);
        }
      }
    } catch (e) {
      console.warn("[OpenInContainerWindow] Failed to read pref", key, e);
    }
    return fallback;
  };

  // ─── Constants ──────────────────────────────────────────────────
  const ACCESS_KEY = "W";

  // ═══════════════════════════════════════════════════════════════
  //  MAIN INITIALISATION
  // ═══════════════════════════════════════════════════════════════
  function init() {
    // Patch the main browser document's placesContext (bookmarks)
    patchPlacesContext(document);
    // Watch for sidebar loads to patch the sidebar's own placesContext
    watchSidebar();
    // Patch the general content area context menu (right-click on links)
    patchContentAreaContextMenu();
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 1: BOOKMARKS CONTEXT MENU (placesContext)
  // ═══════════════════════════════════════════════════════════════

  // ─── Patch any document's placesContext with our menu + interceptor ─
  function patchPlacesContext(doc) {
    const placesContext = doc.getElementById("placesContext");
    if (!placesContext) {
      // Retry for main document only
      if (doc === document) {
        setTimeout(() => patchPlacesContext(doc), 500);
      }
      return;
    }

    // Don't patch the same context twice
    if (placesContext._openInContainerPatched) return;
    placesContext._openInContainerPatched = true;

    // Create the parent <menu> (shows as a menu item with a submenu arrow)
    // We clone the native 'Open in New Container Tab' menu so we get its identical internal
    // structure (like .menu-icon and .menu-text) which fixes styling offsets especially when CMI is active.
    let menu;
    let popup;
    const nativeMenu = doc.getElementById("placesContext_open:newcontainertab");

    if (nativeMenu) {
      menu = nativeMenu.cloneNode(true);
      menu.id = "placesContext_openInContainerWindow";

      // Remove localization bindings so Firefox doesn't overwrite our custom text
      menu.removeAttribute("data-l10n-id");
      menu.removeAttribute("data-l10n-args");

      menu.setAttribute("label", "Open in New Container Window");
      menu.setAttribute("accesskey", ACCESS_KEY);

      const textLabel = menu.querySelector(".menu-text");
      if (textLabel) {
        textLabel.removeAttribute("data-l10n-id");
        textLabel.removeAttribute("data-l10n-args");
        textLabel.setAttribute("value", "Open in New Container Window");
        textLabel.setAttribute("accesskey", ACCESS_KEY);
      }

      popup = menu.querySelector("menupopup");
      if (popup) {
        popup.id = "placesContext_openInContainerWindowPopup";
        popup.innerHTML = ""; // clear the cloned menu items
      }
    }

    if (!menu) {
      // Fallback
      menu = doc.createXULElement("menu");
      menu.id = "placesContext_openInContainerWindow";
      menu.setAttribute("label", "Open in New Container Window");
      menu.setAttribute("accesskey", ACCESS_KEY);
    }

    if (!popup) {
      popup = doc.createXULElement("menupopup");
      popup.id = "placesContext_openInContainerWindowPopup";
      menu.appendChild(popup);
    }

    // ─── Position after "Open in New Window" ─────────────────────
    const refNode =
      doc.getElementById("placesContext_open:newwindow") ||
      doc.getElementById("placesContext_openLinks:newwindow");
    if (refNode && refNode.nextSibling) {
      placesContext.insertBefore(menu, refNode.nextSibling);
    } else {
      placesContext.appendChild(menu);
    }

    // ─── Build container list dynamically on each popup show ─────
    popup.addEventListener("popupshowing", () => {
      buildContainerMenu(popup, (ucId) => {
        openInContainerWindow(ucId, null, doc);
      }, doc);
    });

    // ─── Control visibility on parent context menu show ──────────
    placesContext.addEventListener("popupshowing", () => {
      updateBookmarkMenuVisibility(menu, doc);
    });

    // ─── Intercept native "Open in New Window" for auto-container ─
    interceptBookmarkOpenInNewWindow(placesContext, doc);
  }

  // ─── Watch for sidebar loads ─────────────────────────────────────
  function watchSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    sidebar.addEventListener("load", () => {
      try {
        const sidebarDoc = sidebar.contentDocument;
        if (!sidebarDoc) return;
        const sidebarPlacesContext = sidebarDoc.getElementById("placesContext");
        if (sidebarPlacesContext) {
          patchPlacesContext(sidebarDoc);
        }
      } catch (err) {
        // Cross-origin or not available — ignore
      }
    }, true);

    // Also check if the sidebar is already loaded with a bookmarks panel
    try {
      if (sidebar.contentDocument) {
        const sidebarPlacesContext = sidebar.contentDocument.getElementById("placesContext");
        if (sidebarPlacesContext) {
          patchPlacesContext(sidebar.contentDocument);
        }
      }
    } catch (_) { }
  }

  // ─── Show / hide bookmark menu (bookmarks only) ────────────────
  function updateBookmarkMenuVisibility(menu, doc) {
    let shouldShow = false;
    try {
      const popup = doc.getElementById("placesContext");
      const triggerNode = popup.triggerNode;
      if (triggerNode) {
        const node = getPlacesNodeFromTrigger(triggerNode, doc);
        if (node) {
          shouldShow =
            node.type === Ci.nsINavHistoryResultNode.RESULT_TYPE_URI ||
            node.type === 0;
        }
      }
    } catch (e) {
      shouldShow = false;
    }
    menu.hidden = !shouldShow;
  }

  // ─── Retrieve Places node from the trigger element ─────────────
  function getPlacesNodeFromTrigger(triggerNode, doc) {
    doc = doc || document;
    try {
      // 1. Try PlacesUIUtils.getViewForNode
      if (typeof PlacesUIUtils !== "undefined") {
        try {
          const view = PlacesUIUtils.getViewForNode(triggerNode);
          if (view && view.selectedNode) {
            return view.selectedNode;
          }
        } catch (_) { }
      }

      // 2. Walk up from the trigger node to find _placesNode (toolbar items)
      let node = triggerNode;
      while (node) {
        if (node._placesNode) return node._placesNode;
        if (node.node) return node.node;
        node = node.parentNode;
      }

      // 3. Try the sidebar's ContentTree (bookmarks panel)
      try {
        const sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.contentWindow) {
          const sidebarWin = sidebar.contentWindow;
          if (sidebarWin.ContentTree && sidebarWin.ContentTree.view) {
            const selectedNode = sidebarWin.ContentTree.view.selectedNode;
            if (selectedNode) return selectedNode;
          }
        }
      } catch (_) { }

      // 4. Fallback: try the popup's triggerNode through the doc
      const popup = doc.getElementById("placesContext");
      if (popup && popup.triggerNode && popup.triggerNode !== triggerNode) {
        return getPlacesNodeFromTrigger(popup.triggerNode, doc);
      }
    } catch (e) {
      // Silently fail
    }
    return null;
  }

  // ─── Intercept bookmark "Open in New Window" ───────────────────
  function interceptBookmarkOpenInNewWindow(placesContext, doc) {
    doc = doc || document;
    let originalOnCommand = null;
    let originalCommand = null;
    let patched = false;

    placesContext.addEventListener("popupshowing", () => {
      const openNewWindow = doc.getElementById(
        "placesContext_open:newwindow",
      );
      if (!openNewWindow) return;

      // Save originals once
      if (!patched) {
        originalOnCommand = openNewWindow.getAttribute("oncommand");
        originalCommand = openNewWindow.getAttribute("command");
        patched = true;
      }

      // Check pref LIVE on every menu open
      const isEnabled = getPref(PREF_AUTO_CONTAINER, true);

      if (isEnabled) {
        // Replace oncommand with a no-op instead of removing it.
        // removeAttribute leaves the compiled handler cached — setAttribute
        // overwrites it so the native action cannot fire.
        openNewWindow.setAttribute("oncommand", "/* intercepted */");
        openNewWindow.removeAttribute("command");

        if (openNewWindow._containerHandler) {
          openNewWindow.removeEventListener(
            "command",
            openNewWindow._containerHandler,
          );
        }

        openNewWindow._containerHandler = async (event) => {
          // Stop propagation to prevent any other listeners from also opening a window
          event.stopPropagation();
          event.stopImmediatePropagation();

          // Capture triggerNode and URL synchronously (before popup closes
          // and triggerNode becomes null after the await below)
          const triggerNode =
            doc.getElementById("placesContext")?.triggerNode;
          if (!triggerNode) {
            _runOriginalBookmarkOpen(doc);
            return;
          }

          const node = getPlacesNodeFromTrigger(triggerNode, doc);
          if (!node || !node.uri) {
            _runOriginalBookmarkOpen(doc);
            return;
          }

          // Pre-capture URL so we can use it after the async call
          // (by then the popup is closed and triggerNode is null)
          const url = node.uri;

          let userContextId = 0;
          try {
            userContextId = await getWorkspaceContainerForBookmark(node);
          } catch (e) {
            console.warn("[OpenInContainerWindow] Container lookup failed:", e);
          }

          if (userContextId > 0) {
            openInContainerWindow(userContextId, url, doc);
          } else {
            // Fallback: open in regular window using pre-captured URL
            // (can't use _runOriginalBookmarkOpen here because
            // popup.triggerNode is null after await)
            openTrustedLinkIn(url, "window", {
              triggeringPrincipal:
                Services.scriptSecurityManager.getSystemPrincipal(),
            });
          }
        };

        openNewWindow.addEventListener("command", openNewWindow._containerHandler);
      } else {
        // Pref is OFF — restore native behavior
        if (openNewWindow._containerHandler) {
          openNewWindow.removeEventListener(
            "command",
            openNewWindow._containerHandler,
          );
          openNewWindow._containerHandler = null;
        }
        if (originalOnCommand) {
          openNewWindow.setAttribute("oncommand", originalOnCommand);
        }
        if (originalCommand) {
          openNewWindow.setAttribute("command", originalCommand);
        }
      }
    });
  }

  // ─── Run the original bookmark "Open in New Window" command ─────
  function _runOriginalBookmarkOpen(doc) {
    doc = doc || document;
    try {
      const popup = doc.getElementById("placesContext");
      const triggerNode = popup?.triggerNode;
      if (triggerNode) {
        const node = getPlacesNodeFromTrigger(triggerNode, doc);
        if (node && node.uri) {
          openTrustedLinkIn(node.uri, "window", {
            triggeringPrincipal:
              Services.scriptSecurityManager.getSystemPrincipal(),
          });
          return;
        }
      }
    } catch (e) {
      console.warn("[OpenInContainerWindow] Bookmark fallback open failed:", e);
    }
  }

  // ─── Resolve a bookmark's workspace container ──────────────────
  async function getWorkspaceContainerForBookmark(node) {
    try {
      if (
        typeof ZenWorkspaceBookmarksStorage === "undefined" ||
        typeof gZenWorkspaces === "undefined"
      ) {
        return 0;
      }

      let currentNode = node;
      while (currentNode) {
        const guid = currentNode.bookmarkGuid;
        if (guid) {
          const workspaceUuids =
            await ZenWorkspaceBookmarksStorage.getBookmarkWorkspaces(guid);
          if (workspaceUuids && workspaceUuids.length > 0) {
            const workspace = gZenWorkspaces.getWorkspaceFromId(
              workspaceUuids[0],
            );
            if (workspace && workspace.containerTabId) {
              return workspace.containerTabId;
            }
          }
        }
        currentNode = currentNode.parent;
      }
    } catch (e) {
      console.warn(
        "[OpenInContainerWindow] Failed to resolve workspace container:",
        e,
      );
    }
    return 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECTION 2: GLOBAL CONTENT AREA CONTEXT MENU (links on pages)
  // ═══════════════════════════════════════════════════════════════

  function patchContentAreaContextMenu() {
    const contentContext = document.getElementById("contentAreaContextMenu");
    if (!contentContext) {
      setTimeout(patchContentAreaContextMenu, 500);
      return;
    }

    if (contentContext._openInContainerWindowPatched) return;
    contentContext._openInContainerWindowPatched = true;

    // ─── Create "Open Link in New Container Window" submenu ─────
    let menu;
    let popup;

    // Try to clone the native "Open Link in New Container Tab" menu for styling consistency
    const nativeMenu = document.getElementById("context-openlinkinusercontext-menu");

    if (nativeMenu) {
      menu = nativeMenu.cloneNode(true);
      menu.id = "context-openLinkInContainerWindow";

      menu.removeAttribute("data-l10n-id");
      menu.removeAttribute("data-l10n-args");

      menu.setAttribute("label", "Open Link in New Container Window");
      menu.setAttribute("accesskey", ACCESS_KEY);

      const textLabel = menu.querySelector(".menu-text");
      if (textLabel) {
        textLabel.removeAttribute("data-l10n-id");
        textLabel.removeAttribute("data-l10n-args");
        textLabel.setAttribute("value", "Open Link in New Container Window");
        textLabel.setAttribute("accesskey", ACCESS_KEY);
      }

      popup = menu.querySelector("menupopup");
      if (popup) {
        popup.id = "context-openLinkInContainerWindowPopup";
        popup.innerHTML = "";
      }
    }

    if (!menu) {
      menu = document.createXULElement("menu");
      menu.id = "context-openLinkInContainerWindow";
      menu.setAttribute("label", "Open Link in New Container Window");
      menu.setAttribute("accesskey", ACCESS_KEY);
      menu.classList.add("context-menu-open-link");
    }

    // Ensure the class is always present (clone may or may not have it)
    if (!menu.classList.contains("context-menu-open-link")) {
      menu.classList.add("context-menu-open-link");
    }

    if (!popup) {
      popup = document.createXULElement("menupopup");
      popup.id = "context-openLinkInContainerWindowPopup";
      menu.appendChild(popup);
    }

    // ─── Position after "Open Link in New Window" ────────────────
    const refNode = document.getElementById("context-openlink");
    if (refNode && refNode.nextSibling) {
      contentContext.insertBefore(menu, refNode.nextSibling);
    } else {
      contentContext.appendChild(menu);
    }

    // ─── Build container list for links ──────────────────────────
    popup.addEventListener("popupshowing", () => {
      buildContainerMenu(popup, (ucId) => {
        const url = getLinkURLFromContextMenu();
        if (url) {
          openInContainerWindow(ucId, url);
        }
      }, document);
    });

    // ─── Show/hide based on whether a link was right-clicked ─────
    contentContext.addEventListener("popupshowing", () => {
      updateLinkMenuVisibility(menu);
    });

    // ─── Intercept native "Open Link in New Window" ──────────────
    interceptLinkOpenInNewWindow(contentContext);
  }

  // ─── Show/hide the link container menu ─────────────────────────
  function updateLinkMenuVisibility(menu) {
    try {
      // gContextMenu is set by Firefox when the content area context menu opens
      // .onLink is true when the user right-clicked on a hyperlink
      menu.hidden = !(gContextMenu && gContextMenu.onLink);
    } catch (e) {
      menu.hidden = true;
    }
  }

  // ─── Get the link URL from the content area context menu ───────
  function getLinkURLFromContextMenu() {
    try {
      if (gContextMenu && gContextMenu.linkURL) {
        return gContextMenu.linkURL;
      }
    } catch (e) {
      console.warn("[OpenInContainerWindow] Failed to get link URL:", e);
    }
    return null;
  }

  // ─── Get the current tab's container ───────────────────────────
  function getCurrentTabContainer() {
    try {
      const tab = gBrowser.selectedTab;
      if (tab) {
        const ucId = tab.getAttribute("usercontextid");
        if (ucId && parseInt(ucId, 10) > 0) {
          return parseInt(ucId, 10);
        }
      }
    } catch (e) {
      console.warn("[OpenInContainerWindow] Failed to get current tab container:", e);
    }
    return 0;
  }

  // ─── Intercept "Open Link in New Window" on general context menu ─
  function interceptLinkOpenInNewWindow(contentContext) {
    let originalOnCommand = null;
    let originalCommand = null;
    let patched = false;

    contentContext.addEventListener("popupshowing", () => {
      const openLink = document.getElementById("context-openlink");
      if (!openLink) return;

      if (!patched) {
        originalOnCommand = openLink.getAttribute("oncommand");
        originalCommand = openLink.getAttribute("command");
        patched = true;
      }

      const isEnabled = getPref(PREF_AUTO_CONTAINER_GLOBAL, true);

      if (isEnabled) {
        // Replace oncommand with a no-op instead of removing it.
        // removeAttribute leaves the compiled handler cached — setAttribute
        // overwrites it so the native action cannot fire.
        openLink.setAttribute("oncommand", "/* intercepted */");
        openLink.removeAttribute("command");

        if (openLink._containerHandler) {
          openLink.removeEventListener("command", openLink._containerHandler);
        }

        openLink._containerHandler = (event) => {
          // Stop propagation to prevent any other listeners from also opening a window
          event.stopPropagation();
          event.stopImmediatePropagation();

          const url = getLinkURLFromContextMenu();
          if (!url) {
            _runOriginalLinkOpen(originalOnCommand, originalCommand);
            return;
          }

          const userContextId = getCurrentTabContainer();

          if (userContextId > 0) {
            openInContainerWindow(userContextId, url);
          } else {
            _runOriginalLinkOpen(originalOnCommand, originalCommand);
          }
        };

        openLink.addEventListener("command", openLink._containerHandler);
      } else {
        // Pref is OFF — restore native behavior
        if (openLink._containerHandler) {
          openLink.removeEventListener("command", openLink._containerHandler);
          openLink._containerHandler = null;
        }
        if (originalOnCommand) {
          openLink.setAttribute("oncommand", originalOnCommand);
        }
        if (originalCommand) {
          openLink.setAttribute("command", originalCommand);
        }
      }
    });
  }

  // ─── Run the original "Open Link in New Window" command ────────
  function _runOriginalLinkOpen(originalOnCommand, originalCommand) {
    try {
      const url = getLinkURLFromContextMenu();
      if (url) {
        openTrustedLinkIn(url, "window", {
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal(),
        });
        return;
      }
    } catch (e) {
      console.warn("[OpenInContainerWindow] Link fallback open failed:", e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SHARED UTILITIES
  // ═══════════════════════════════════════════════════════════════

  // ─── Build / rebuild the container submenu items ───────────────
  function buildContainerMenu(popup, onSelectCallback, doc) {
    doc = doc || document;
    // Clear existing items
    while (popup.firstChild) {
      popup.removeChild(popup.firstChild);
    }

    // Get all containers
    let identities = [];
    try {
      identities = ContextualIdentityService.getPublicIdentities() || [];
    } catch (e) {
      console.warn(
        "[OpenInContainerWindow] ContextualIdentityService not available",
        e,
      );
      return;
    }

    if (identities.length === 0) {
      const emptyItem = doc.createXULElement("menuitem");
      emptyItem.setAttribute("label", "No containers available");
      emptyItem.setAttribute("disabled", "true");
      popup.appendChild(emptyItem);
      return;
    }

    identities.forEach((identity) => {
      const item = doc.createXULElement("menuitem");

      const name =
        ContextualIdentityService.getUserContextLabel(identity.userContextId) ||
        identity.name;

      item.setAttribute("label", name);
      item.setAttribute("data-usercontextid", identity.userContextId);

      item.classList.add(
        "menuitem-iconic",
        `identity-color-${identity.color}`,
        `identity-icon-${identity.icon}`,
      );

      item.addEventListener("command", () => {
        onSelectCallback(identity.userContextId);
      });

      popup.appendChild(item);
    });
  }

  // ─── Open a URL in a new window with a specific container ──────
  function openInContainerWindow(userContextId, urlOverride, doc) {
    doc = doc || document;
    let url = urlOverride || null;

    // If no URL provided, try to get it from the places context (bookmarks)
    if (!url) {
      try {
        const popup = doc.getElementById("placesContext");
        const triggerNode = popup.triggerNode;
        if (triggerNode) {
          const node = getPlacesNodeFromTrigger(triggerNode, doc);
          if (node && node.uri) {
            url = node.uri;
          }
        }
      } catch (e) {
        console.error(
          "[OpenInContainerWindow] Failed to get URL:",
          e,
        );
      }
    }

    if (!url) {
      console.warn("[OpenInContainerWindow] No URL found");
      return;
    }

    try {
      openTrustedLinkIn(url, "window", {
        userContextId: userContextId,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    } catch (e) {
      console.error("[OpenInContainerWindow] Failed to open window:", e);
      try {
        const newWin = OpenBrowserWindow({ private: false });
        newWin.addEventListener(
          "load",
          () => {
            newWin.gBrowser.selectedTab = newWin.gBrowser.addTab(url, {
              triggeringPrincipal:
                Services.scriptSecurityManager.getSystemPrincipal(),
              userContextId: userContextId,
            });
          },
          { once: true },
        );
      } catch (e2) {
        console.error("[OpenInContainerWindow] Fallback also failed:", e2);
      }
    }
  }

  // No custom CSS needed — Zen's native identity-color-* / identity-icon-*
  // classes handle all container styling automatically.

  // ─── Bootstrap ─────────────────────────────────────────────────
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", () => init(), { once: true });
  }
})();
