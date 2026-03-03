(function () {
  "use strict";

  // ─── Preference Keys ────────────────────────────────────────────
  const PREF_AUTO_CONTAINER = "extensions.openInContainerWindow.autoContainerWindow";

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

  // ─── Main initialisation ────────────────────────────────────────
  function init() {
    // Patch the main browser document's placesContext
    patchPlacesContext(document);
    // Watch for sidebar loads to patch the sidebar's own placesContext
    watchSidebar();
  }

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
      buildContainerMenu(popup, doc);
    });

    // ─── Control visibility on parent context menu show ──────────
    placesContext.addEventListener("popupshowing", () => {
      updateMenuVisibility(menu, doc);
    });

    // ─── Intercept native "Open in New Window" for auto-container ─
    interceptOpenInNewWindow(placesContext, doc);
  }

  // ─── Watch for sidebar loads ─────────────────────────────────────
  function watchSidebar() {
    // The sidebar <browser> element loads different panels as separate documents.
    // When the bookmarks sidebar opens, it creates its OWN placesContext popup
    // (via #include placesContextMenu.inc.xhtml in bookmarksSidebar.xhtml).
    // We need to patch that separate context menu too.
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;

    // Listen for new documents loading in the sidebar
    sidebar.addEventListener("load", () => {
      try {
        const sidebarDoc = sidebar.contentDocument;
        if (!sidebarDoc) return;

        // Check if this panel has a placesContext (bookmarks, history, etc.)
        const sidebarPlacesContext = sidebarDoc.getElementById("placesContext");
        if (sidebarPlacesContext) {
          patchPlacesContext(sidebarDoc);
        }
      } catch (err) {
        // Cross-origin or not available — ignore
      }
    }, true); // Use capture phase to catch the load event from the iframe

    // Also check if the sidebar is already loaded with a bookmarks panel
    try {
      if (sidebar.contentDocument) {
        const sidebarPlacesContext = sidebar.contentDocument.getElementById("placesContext");
        if (sidebarPlacesContext) {
          patchPlacesContext(sidebar.contentDocument);
        }
      }
    } catch (_) {}
  }

  // ─── Show / hide depending on context (bookmarks only) ─────────
  function updateMenuVisibility(menu, doc) {
    let shouldShow = false;

    try {
      const popup = doc.getElementById("placesContext");
      const triggerNode = popup.triggerNode;

      if (triggerNode) {
        const node = getPlacesNodeFromTrigger(triggerNode, doc);
        if (node) {
          // Show only for URI-type nodes (actual bookmarks, not folders/separators)
          shouldShow =
            node.type === Ci.nsINavHistoryResultNode.RESULT_TYPE_URI ||
            node.type === 0;
        }
      }
    } catch (e) {
      // If anything goes wrong, hide the menu
      shouldShow = false;
    }

    menu.hidden = !shouldShow;
  }

  // ─── Retrieve Places node from the trigger element ─────────────
  function getPlacesNodeFromTrigger(triggerNode, doc) {
    doc = doc || document;
    try {
      // 1. Try PlacesUIUtils.getViewForNode — canonical Firefox approach
      //    Works for toolbar, sidebar tree, library, etc.
      if (typeof PlacesUIUtils !== "undefined") {
        try {
          const view = PlacesUIUtils.getViewForNode(triggerNode);
          if (view && view.selectedNode) {
            return view.selectedNode;
          }
        } catch (_) {}
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
      } catch (_) {}

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

  // ─── Build / rebuild the container submenu items ───────────────
  function buildContainerMenu(popup, doc) {
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

      // Use the localized name via ContextualIdentityService
      const name =
        ContextualIdentityService.getUserContextLabel(identity.userContextId) ||
        identity.name;

      item.setAttribute("label", name);
      item.setAttribute("data-usercontextid", identity.userContextId);

      // Use native CSS classes for colour and icon — matches Zen's built-in
      // "Open in New Container Tab" appearance exactly
      item.classList.add(
        "menuitem-iconic",
        `identity-color-${identity.color}`,
        `identity-icon-${identity.icon}`,
      );

      item.addEventListener("command", () => {
        openBookmarkInContainerWindow(identity.userContextId, null, doc);
      });

      popup.appendChild(item);
    });
  }

  // ─── Open the bookmark URL in a new window with container ──────
  function openBookmarkInContainerWindow(userContextId, urlOverride, doc) {
    doc = doc || document;
    let url = urlOverride || null;

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
          "[OpenInContainerWindow] Failed to get bookmark URL:",
          e,
        );
      }
    }

    if (!url) {
      console.warn("[OpenInContainerWindow] No URL found for the bookmark");
      return;
    }

    try {
      // openTrustedLinkIn opens URLs with system principal in a new window
      // with the specified userContextId (container)
      openTrustedLinkIn(url, "window", {
        userContextId: userContextId,
        triggeringPrincipal:
          Services.scriptSecurityManager.getSystemPrincipal(),
      });
    } catch (e) {
      console.error("[OpenInContainerWindow] Failed to open window:", e);
      // Fallback: open a normal new window and immediately navigate
      try {
        const newWin = OpenBrowserWindow({ private: false });
        // Once the window is ready, open the URL in a container tab
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

  // ─── Resolve a bookmark's workspace container ──────────────────
  async function getWorkspaceContainerForBookmark(node) {
    try {
      if (
        typeof ZenWorkspaceBookmarksStorage === "undefined" ||
        typeof gZenWorkspaces === "undefined"
      ) {
        return 0;
      }

      // Try the bookmark itself first, then walk up to parent folders
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
        // Walk up to the parent folder
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

  // ─── Intercept native "Open in New Window" ─────────────────────
  function interceptOpenInNewWindow(placesContext, doc) {
    doc = doc || document;
    // Store the original command/oncommand for restoration
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
        // Remove native command bindings so our handler takes over
        openNewWindow.removeAttribute("oncommand");
        openNewWindow.removeAttribute("command");

        // Remove any previously attached listener to avoid duplicates
        if (openNewWindow._containerHandler) {
          openNewWindow.removeEventListener(
            "command",
            openNewWindow._containerHandler,
          );
        }

        // Create handler for this menu show
        openNewWindow._containerHandler = async () => {
          const triggerNode =
            doc.getElementById("placesContext")?.triggerNode;
          if (!triggerNode) {
            _runOriginalOpenNewWindow(doc);
            return;
          }

          const node = getPlacesNodeFromTrigger(triggerNode, doc);
          if (!node || !node.uri) {
            _runOriginalOpenNewWindow(doc);
            return;
          }

          let userContextId = 0;
          try {
            userContextId = await getWorkspaceContainerForBookmark(node);
          } catch (e) {
            console.warn("[OpenInContainerWindow] Container lookup failed:", e);
          }

          if (userContextId > 0) {
            openBookmarkInContainerWindow(userContextId, node.uri, doc);
          } else {
            _runOriginalOpenNewWindow(doc);
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

  // ─── Run the original "Open in New Window" command ──────────────
  function _runOriginalOpenNewWindow(doc) {
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
      console.warn("[OpenInContainerWindow] Fallback open failed:", e);
    }
  }

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
