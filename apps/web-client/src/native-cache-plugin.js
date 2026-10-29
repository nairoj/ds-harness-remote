// Runs inside the native iframe and uses its public Session, navigation, slot, and workspace file services.
window.__ModuleLoader__.load({
  id: "dsh-remote-web-cache",
  factory: (require) => {
    const React = require("react");
    const {
      Button,
      IconDownloadOutlineRegular,
      Tooltip,
    } = require("@deepseek-ai/dsh-client-ui-primitives");
    const DOWNLOAD_NS = "remoteWebDownload";
    const DOWNLOAD_DICT = {
      zh: {
        download: "下载",
        downloading: "下载中…",
        failed: "下载失败",
      },
      en: {
        download: "Download",
        downloading: "Downloading…",
        failed: "Download failed",
      },
    };
    const fileNameOf = (path) => {
      const normalized = String(path ?? "").replace(/[\\/]+$/, "");
      const idx = Math.max(
        normalized.lastIndexOf("/"),
        normalized.lastIndexOf("\\"),
      );
      return idx >= 0 ? normalized.slice(idx + 1) || "download" : normalized || "download";
    };
    const mimeTypeOf = (name) => {
      const ext = name.includes(".")
        ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
        : "";
      switch (ext) {
        case "pdf":
          return "application/pdf";
        case "png":
          return "image/png";
        case "jpg":
        case "jpeg":
          return "image/jpeg";
        case "gif":
          return "image/gif";
        case "webp":
          return "image/webp";
        case "svg":
          return "image/svg+xml";
        case "json":
          return "application/json";
        case "csv":
          return "text/csv;charset=utf-8";
        case "md":
        case "txt":
        case "log":
          return "text/plain;charset=utf-8";
        case "html":
        case "htm":
          return "text/html;charset=utf-8";
        default:
          return "application/octet-stream";
      }
    };
    const triggerBrowserDownload = (bytes, path) => {
      const name = fileNameOf(path);
      const blob = new Blob([bytes], { type: mimeTypeOf(name) });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    function createDownloadComponent(empty) {
      return function RemoteDocumentDownloadAction(props) {
        const { sessionId, absolutePath, downloadFile, t } = props;
        const [busy, setBusy] = React.useState(false);
        const [failed, setFailed] = React.useState(false);
        const onClick = () => {
          if (busy || !sessionId || !absolutePath) return;
          setBusy(true);
          setFailed(false);
          void downloadFile(sessionId, absolutePath)
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        };
        const label = busy
          ? t("downloading")
          : failed
            ? t("failed")
            : t("download");
        if (empty) {
          return React.createElement(
            Button,
            {
              variant: "secondary",
              size: "md",
              disabled: busy,
              "data-remote-download": "empty",
              onClick,
            },
            React.createElement(IconDownloadOutlineRegular, { size: 15 }),
            React.createElement("span", null, label),
          );
        }
        return React.createElement(
          Tooltip,
          { label, side: "bottom", delayMs: 400 },
          React.createElement(
            "button",
            {
              type: "button",
              disabled: busy,
              "aria-label": label,
              "data-textpreview-tool": "download",
              "data-remote-download": "header",
              onClick,
              style: {
                display: "inline-flex",
                flex: "none",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                padding: "6px",
                color: failed
                  ? "var(--dsw-alias-state-error-primary)"
                  : "var(--dsw-alias-label-secondary)",
                lineHeight: 1,
                background: "transparent",
                border: "none",
                borderRadius: "var(--dsw-radius-sm)",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              },
            },
            React.createElement(IconDownloadOutlineRegular, { size: 15 }),
          ),
        );
      };
    }
    const HeaderDownloadAction = createDownloadComponent(false);
    const EmptyDownloadAction = createDownloadComponent(true);
    return {
      inject: [
        "sessions",
        "uiWorkspace",
        "workspaces",
        "slots",
        "locale",
        "remote",
        "remote.workspaceFiles",
        "sidebarRight",
      ],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(DOWNLOAD_NS, DOWNLOAD_DICT),
          "dsh-remote-web-cache: download locale",
        );
        const downloadInject = () => ({
          downloadFile: async (sessionId, absolutePath) => {
            const res = await ctx.remote.workspaceFiles.readBytes(
              sessionId,
              absolutePath,
              {},
            );
            if (!res?.ok || !(res.value?.data instanceof Uint8Array)) {
              throw new Error(res?.error?.message ?? "Failed to read file bytes");
            }
            triggerBrowserDownload(
              res.value.data,
              res.value.absolutePath ?? absolutePath,
            );
          },
        });
        ctx.slots.inject("sidebar.right.tab.document.actions", () =>
          ctx.slots.register(
            {
              name: "sidebar.right.tab.document.actions",
              id: "remote-web-download",
              locale: DOWNLOAD_NS,
              inject: downloadInject,
            },
            HeaderDownloadAction,
          ),
        );
        ctx.slots.inject("sidebar.right.tab.document.unpreviewable", () =>
          ctx.slots.register(
            {
              name: "sidebar.right.tab.document.unpreviewable",
              id: "remote-web-download",
              locale: DOWNLOAD_NS,
              inject: downloadInject,
            },
            EmptyDownloadAction,
          ),
        );
        const bridge = parent.dshRemoteTransport;
      const cache = bridge.cache;
      const MAX_RETAINED_SESSIONS = 8;
      const PREWARM_SESSIONS = 4;
      const retained = new Map();
      let prewarmed = false;
      let prewarming = false;
      let disposed = false;
      let selected;
      let requested = cache.current;
      let disposeEvents = () => {};
      let disposeState = () => {};
      let saveTimer;
      let restoreTimer;
      let restoring = false;
      let position;
      let positionRestored = false;
      let loadingPosition = false;
      const retainLru = (id) => {
        if (!id || disposed) return undefined;
        const existing = retained.get(id);
        if (existing) {
          retained.delete(id);
          retained.set(id, existing);
          return existing;
        }
        try {
          const ref = ctx.sessions.retain(id, { source: "webCache" });
          retained.set(id, ref);
          while (retained.size > MAX_RETAINED_SESSIONS) {
            const [oldestId, oldestRef] = retained.entries().next().value;
            if (oldestId === selected) {
              retained.delete(oldestId);
              retained.set(oldestId, oldestRef);
              if (retained.size <= 1) break;
              continue;
            }
            retained.delete(oldestId);
            oldestRef.release();
          }
          return ref;
        } catch {
          return undefined;
        }
      };
      const releaseRetained = (id) => {
        const ref = retained.get(id);
        if (!ref) return;
        retained.delete(id);
        ref.release();
      };
      const runPrewarm = async () => {
        if (prewarmed || prewarming || disposed) return;
        const list = ctx.sessions.list.getSnapshot();
        if (list.phase !== "ready") return;
        const currentBinding = selected && ctx.sessions.binding(selected);
        if (
          currentBinding &&
          currentBinding.session.getSnapshot().openState === "loading"
        )
          return;
        prewarming = true;
        try {
          const archived = new Set(
            ctx.workspaces?.list?.getSnapshot()?.archivedSessionIds ?? [],
          );
          const candidates = [];
          const seen = new Set(selected ? [selected] : []);
          const addCandidate = (id) => {
            const row = list.byId[id];
            if (
              !row ||
              row.blank ||
              row.origin === "subagent" ||
              archived.has(id) ||
              seen.has(id)
            )
              return;
            seen.add(id);
            candidates.push(id);
          };
          for (const id of cache.recentIds?.() ?? []) addCandidate(id);
          const sorted = Object.values(list.byId)
            .filter((row) => !row.blank && row.origin !== "subagent")
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
          for (const row of sorted) {
            if (candidates.length >= PREWARM_SESSIONS) break;
            addCandidate(row.id);
          }
          for (const id of candidates.slice(0, PREWARM_SESSIONS)) {
            if (disposed) return;
            const ref = retainLru(id);
            if (ref?.ready) await ref.ready.catch(() => {});
          }
          prewarmed = true;
        } finally {
          prewarming = false;
          if (!disposed) bridge.rpc.triggerBackgroundRefresh?.();
        }
      };
      const scroller = () =>
        document.querySelector("[data-conversation-scroll]");
      const savePosition = () => {
        if (!selected || restoring || !positionRestored) return;
        const node = scroller();
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const anchor = [
          ...node.querySelectorAll("[data-chat-anchor-key]"),
        ].find((el) => el.getBoundingClientRect().bottom > rect.top);
        cache.storePosition(selected, {
          scrollTop: node.scrollTop,
          tail: node.scrollHeight - node.clientHeight - node.scrollTop < 24,
          anchorKey: anchor?.getAttribute("data-chat-anchor-key"),
          anchorTop: anchor
            ? anchor.getBoundingClientRect().top - rect.top
            : undefined,
          firstSeq: ctx.sessions.binding(selected)?.eventSource.getSnapshot()
            .entries[0]?.event.seq,
        });
      };
      const restorePosition = () => {
        if (!selected || positionRestored || restoring || loadingPosition)
          return;
        const target = selected;
        const binding = ctx.sessions.binding(selected);
        if (binding?.session.getSnapshot().openState !== "open") return;
        const first = binding.eventSource.getSnapshot().entries[0]?.event.seq;
        if (
          typeof position?.firstSeq === "number" &&
          typeof first === "number" &&
          first > position.firstSeq
        ) {
          loadingPosition = true;
          binding.session
            .loadThrough(position.firstSeq)
            .catch(() => {})
            .finally(() => {
              if (selected !== target) return;
              loadingPosition = false;
              if (position) position = { ...position, firstSeq: undefined };
              restorePosition();
            });
          return;
        }
        const node = scroller();
        if (!node || !node.querySelector("[data-chat-flow]")) return;
        restoring = true;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (selected !== target) return;
            if (position?.tail) node.scrollTop = node.scrollHeight;
            else if (position) {
              const anchor = [
                ...node.querySelectorAll("[data-chat-anchor-key]"),
              ].find(
                (el) =>
                  el.getAttribute("data-chat-anchor-key") ===
                  position.anchorKey,
              );
              node.scrollTop = anchor
                ? node.scrollTop +
                  anchor.getBoundingClientRect().top -
                  node.getBoundingClientRect().top -
                  (position.anchorTop ?? 0)
                : position.scrollTop;
            }
            positionRestored = true;
            restoring = false;
          }),
        );
      };
      const reconcile = () => {
        const list = ctx.sessions.list.getSnapshot();
        const ws = ctx.workspaces?.list?.getSnapshot();
        const archived = ws?.archivedSessionIds ?? [];
        for (const id of [...retained.keys()]) {
          if (!list.byId[id] || archived.includes(id)) releaseRetained(id);
        }
        const id = Object.values(list.byId).find(
          (row) => (row.retainedBy.mainView ?? 0) > 0,
        )?.id;
        if (requested && archived.includes(requested)) {
          if (bridge.unarchiveRequested === requested) {
            bridge.unarchiveRequested = undefined;
            void ctx.uiWorkspace
              .unarchiveSession(requested)
              .catch(() => {})
              .finally(reconcile);
            return;
          }
          requested = undefined;
        }
        if (requested && list.byId[requested]) {
          if (id === requested) {
            requested = undefined;
          } else {
            ctx.uiWorkspace.openSession(requested);
            return;
          }
        }
        if (requested) return;
        if (!id) {
          if (list.phase === "ready") void runPrewarm();
          return;
        }
        if (id === selected) {
          void runPrewarm();
          return;
        }
        savePosition();
        disposeEvents();
        disposeState();
        selected = id;
        retainLru(id);
        restoring = false;
        loadingPosition = false;
        positionRestored = false;
        position = cache.recent(id)?.position;
        cache.select(id);
        const binding = ctx.sessions.binding(id);
        if (binding) {
          disposeEvents = binding.eventSource.subscribe(() => {
            clearTimeout(restoreTimer);
            restoreTimer = setTimeout(restorePosition, 200);
          });
          disposeState = binding.session.subscribe(() => {
            restorePosition();
            void runPrewarm();
          });
          restorePosition();
          void runPrewarm();
        }
      };
      bridge.rpc.onDirectoryUpdated = () => {
        void ctx.sessions.refresh();
      };
      bridge.openSession = (id) => {
        bridge.unarchiveRequested = id;
        requested = id;
        reconcile();
      };
      bridge.openFile = (sessionId, path) => {
        const normalized = String(path ?? "")
          .replace(/\\/g, "/")
          .replace(/^(?:\.\/)+/, "");
        const encodeSeg = (s) =>
          encodeURIComponent(s).replace(/%3A/gi, ":");
        const addr = `dsh-resource://file/session/${encodeSeg(sessionId)}/${normalized.split("/").map(encodeSeg).join("/")}`;
        ctx.sidebarRight.openResource(addr);
      };
      bridge.retainedSessionIds = () => [...retained.keys()];
      const disposeList = ctx.sessions.list.subscribe(reconcile);
      const disposeWorkspaces =
        ctx.workspaces?.list?.subscribe(reconcile) ?? (() => {});
      const observer = new MutationObserver(restorePosition);
      observer.observe(document.body, { childList: true, subtree: true });
      const onScroll = (event) => {
        if (event.target === scroller()) {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(savePosition, 250);
        }
      };
      document.addEventListener("scroll", onScroll, true);
      window.addEventListener("pagehide", savePosition);
      reconcile();
      ctx.effect(() => () => {
        disposed = true;
        savePosition();
        clearTimeout(saveTimer);
        clearTimeout(restoreTimer);
        for (const ref of retained.values()) ref.release();
        retained.clear();
        disposeList();
        disposeWorkspaces();
        disposeEvents();
        disposeState();
        observer.disconnect();
        document.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("pagehide", savePosition);
        bridge.openSession = undefined;
        bridge.openFile = undefined;
        bridge.retainedSessionIds = undefined;
      });
      },
    };
  },
});
