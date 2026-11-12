(function () {
  "use strict";

  var GUI = window.GUI;
  var MAX_SB3_BYTES = 100 * 1024 * 1024;
  var LOAD_TIMEOUT_MS = 45000;
  var CHANGE_THROTTLE_MS = 1000;
  var LOAD_ERROR = "Scratch couldn't load.";
  var OPEN_ERROR = "This Scratch project couldn't be opened.";
  var EXPORT_ERROR = "This Scratch project couldn't be saved.";

  var ownOrigin = new URL(window.location.href).origin;
  var assetBase = new URL("library-assets/", window.location.href).href;
  var params = new URLSearchParams(window.location.search);
  var startAsPlayer = params.get("mode") === "player";

  var ready = false;
  var loading = false;
  var lastChangeAt = 0;
  var changeTimer = null;
  var store = null;

  function post(message, transfer) {
    window.parent.postMessage(message, ownOrigin, transfer || []);
  }

  function fail(message) {
    post({ type: "scratch:error", message: message });
  }

  function noop() {}

  if (!GUI || typeof GUI.createStandaloneRoot !== "function") {
    fail(LOAD_ERROR);
    return;
  }

  var loadTimer = window.setTimeout(function () {
    if (!ready) fail(LOAD_ERROR);
  }, LOAD_TIMEOUT_MS);

  window.addEventListener("error", function () {
    if (!ready) fail(LOAD_ERROR);
  });

  function createStorage() {
    var storage = new GUI.ScratchStorage();
    var translator;

    function cacheDefaultProject() {
      GUI.buildDefaultProject(translator).forEach(function (asset) {
        storage.builtinHelper._store(
          storage.AssetType[asset.assetType],
          storage.DataFormat[asset.dataFormat],
          asset.data,
          asset.id
        );
      });
    }

    cacheDefaultProject();
    storage.addWebStore(
      [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
      function (asset) {
        return assetBase + asset.assetId + "." + asset.dataFormat;
      }
    );

    return {
      scratchStorage: storage,
      setProjectHost: noop,
      setProjectToken: noop,
      setProjectMetadata: noop,
      setAssetHost: noop,
      setBackpackHost: noop,
      setTranslatorFunction: function (nextTranslator) {
        translator = nextTranslator;
        cacheDefaultProject();
      },
      getLibraryAssetUrl: function (assetId, dataFormat) {
        return assetBase + assetId + "." + dataFormat;
      },
      saveProject: function () {
        return Promise.reject(new Error("Saving is handled by ObeLearn."));
      }
    };
  }

  function getVm() {
    return store.getState().scratchGui.vm;
  }

  function markReady() {
    if (ready) return;
    ready = true;
    window.clearTimeout(loadTimer);
    getVm().on("PROJECT_CHANGED", onProjectChanged);
    post({ type: "scratch:ready" });
  }

  function onProjectChanged() {
    if (loading || changeTimer) return;
    var wait = Math.max(0, lastChangeAt + CHANGE_THROTTLE_MS - Date.now());
    changeTimer = window.setTimeout(function () {
      changeTimer = null;
      lastChangeAt = Date.now();
      post({ type: "scratch:changed" });
    }, wait);
  }

  function setMode(mode) {
    if (mode !== "edit" && mode !== "player") return;
    store.dispatch(GUI.setPlayer(mode === "player"));
  }

  function loadProject(sb3, mode) {
    loading = true;
    setMode(mode);
    getVm()
      .loadProject(sb3)
      .then(function () {
        post({ type: "scratch:loaded" });
      })
      .catch(function () {
        fail(OPEN_ERROR);
      })
      .then(function () {
        window.setTimeout(function () {
          loading = false;
        }, 0);
      });
  }

  function exportProject(requestId) {
    getVm()
      .saveProjectSb3()
      .then(function (blob) {
        return blob.arrayBuffer();
      })
      .then(function (buffer) {
        post(
          { type: "scratch:sb3", requestId: requestId, sb3: buffer, size_bytes: buffer.byteLength },
          [buffer]
        );
      })
      .catch(function () {
        post({ type: "scratch:error", requestId: requestId, message: EXPORT_ERROR });
      });
  }

  function isRequestId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 64;
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== ownOrigin) return;
    var data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (!ready) return;

    if (data.type === "scratch:load") {
      if (!(data.sb3 instanceof ArrayBuffer) || data.sb3.byteLength === 0 || data.sb3.byteLength > MAX_SB3_BYTES) {
        fail(OPEN_ERROR);
        return;
      }
      loadProject(data.sb3, data.mode);
      return;
    }

    if (data.type === "scratch:get-sb3" && isRequestId(data.requestId)) {
      exportProject(data.requestId);
    }
  });

  var appTarget = document.getElementById("app");
  GUI.setAppElement(appTarget);

  var storage = createStorage();
  var state = new GUI.EditorState({ isPlayerOnly: startAsPlayer }, function () {
    return { storage: storage };
  });
  store = state.store;

  store.subscribe(function () {
    if (ready) return;
    var gui = store.getState().scratchGui;
    var loadingState = gui && gui.projectState && gui.projectState.loadingState;
    if (gui && gui.vm && (loadingState === "SHOWING_WITHOUT_ID" || loadingState === "SHOWING_WITH_ID")) {
      markReady();
    }
  });

  GUI.createStandaloneRoot(state, appTarget).render({
    projectId: "0",
    menuBarHidden: true,
    canSave: false,
    canShare: false,
    canCreateNew: false,
    canCreateCopy: false,
    canRemix: false,
    canEditTitle: false,
    canManageFiles: false,
    canChangeLanguage: false,
    canUseCloud: false,
    enableCommunity: false,
    backpackVisible: false,
    showComingSoon: false,
    showNewFeatureCallouts: false,
    hideTutorialProjects: true,
    onClickLogo: noop
  });
})();
