(function () {
  "use strict";

  var GUI = window.GUI;
  var MAX_SB3_BYTES = 100 * 1024 * 1024;
  var LOAD_TIMEOUT_MS = 45000;
  var VIEW_THROTTLE_MS = 500;
  var SETTLE_MS = 300;
  var SETTLE_MAX_MS = 15000;
  var UPDATE_METRICS = "scratch-gui/workspace-metrics/UPDATE_METRICS";
  var LOAD_ERROR = "Scratch couldn't load.";
  var OPEN_ERROR = "This Scratch project couldn't be opened.";
  var EXPORT_ERROR = "This Scratch project couldn't be saved.";

  var ownOrigin = new URL(window.location.href).origin;
  var assetBase = new URL("library-assets/", window.location.href).href;
  var params = new URLSearchParams(window.location.search);
  var startAsPlayer = params.get("mode") === "player";
  var maxAssetBytes = Number(params.get("max-asset-bytes")) || 0;

  var ready = false;
  var loading = false;
  var viewTimer = null;
  var pointerDown = false;
  var lastPointerUp = 0;
  var lastMetrics = null;
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

  function assetBytes(item) {
    var data = item && item.asset && item.asset.data;
    return data ? data.byteLength || data.length || 0 : 0;
  }

  function isTooLarge(item) {
    return assetBytes(item) > maxAssetBytes;
  }

  function refuseAsset() {
    post({ type: "scratch:asset-too-large" });
    return Promise.reject(new Error("Asset too large."));
  }

  function limitAssets(vm) {
    if (!maxAssetBytes) return;
    var addCostume = vm.addCostume.bind(vm);
    var addBackdrop = vm.addBackdrop.bind(vm);
    var addSound = vm.addSound.bind(vm);
    var addSprite = vm.addSprite.bind(vm);
    vm.addCostume = function (md5ext, costume, targetId, version) {
      return isTooLarge(costume) ? refuseAsset() : addCostume(md5ext, costume, targetId, version);
    };
    vm.addBackdrop = function (md5ext, backdrop) {
      return isTooLarge(backdrop) ? refuseAsset() : addBackdrop(md5ext, backdrop);
    };
    vm.addSound = function (sound, targetId) {
      return isTooLarge(sound) ? refuseAsset() : addSound(sound, targetId);
    };
    vm.addSprite = function (input) {
      var before = vm.runtime.targets.map(function (target) {
        return target.id;
      });
      return addSprite(input).then(function (result) {
        var oversized = vm.runtime.targets.filter(function (target) {
          return (
            target.isOriginal &&
            before.indexOf(target.id) === -1 &&
            (target.sprite.costumes.some(isTooLarge) || target.sprite.sounds.some(isTooLarge))
          );
        });
        if (!oversized.length) return result;
        oversized.forEach(function (target) {
          vm.deleteSprite(target.id);
        });
        return refuseAsset();
      });
    };
  }

  function targetKey(target) {
    return target.isStage ? "__stage__" : target.getName();
  }

  function isNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function readView(metrics) {
    var vm = getVm();
    var view = {};
    Object.keys(metrics.targets).forEach(function (id) {
      var target = vm.runtime.getTargetById(id);
      var item = metrics.targets[id];
      if (!target || !item) return;
      view[targetKey(target)] = { scrollX: item.scrollX, scrollY: item.scrollY, scale: item.scale };
    });
    return view;
  }

  function onStoreChange() {
    if (!ready || loading) return;
    var metrics = store.getState().scratchGui.workspaceMetrics;
    if (!metrics || metrics === lastMetrics) return;
    lastMetrics = metrics;
    if (viewTimer) return;
    viewTimer = window.setTimeout(function () {
      viewTimer = null;
      post({ type: "scratch:view", view: readView(lastMetrics) });
    }, VIEW_THROTTLE_MS);
  }

  function restoreView(view) {
    if (!view || typeof view !== "object") return;
    var vm = getVm();
    var restored = false;
    vm.runtime.targets.forEach(function (target) {
      if (!target.isOriginal) return;
      var item = view[targetKey(target)];
      if (!item || !isNumber(item.scrollX) || !isNumber(item.scrollY) || !isNumber(item.scale) || item.scale <= 0) return;
      store.dispatch({
        type: UPDATE_METRICS,
        targetID: target.id,
        scrollX: item.scrollX,
        scrollY: item.scrollY,
        scale: item.scale
      });
      restored = true;
    });
    if (restored) vm.emitWorkspaceUpdate();
  }

  function markReady() {
    if (ready) return;
    ready = true;
    window.clearTimeout(loadTimer);
    getVm().on("PROJECT_CHANGED", onProjectChanged);
    limitAssets(getVm());
    store.subscribe(onStoreChange);
    post({ type: "scratch:ready" });
  }

  function onProjectChanged() {
    if (loading) return;
    post({ type: "scratch:changed" });
  }

  function setMode(mode) {
    if (mode !== "edit" && mode !== "player") return;
    store.dispatch(GUI.setPlayer(mode === "player"));
  }

  function loadProject(sb3, mode, view) {
    loading = true;
    setMode(mode);
    getVm()
      .loadProject(sb3)
      .then(function () {
        restoreView(view);
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

  function releasePointer() {
    pointerDown = false;
    lastPointerUp = Date.now();
  }

  document.addEventListener(
    "pointerdown",
    function () {
      pointerDown = true;
    },
    true
  );
  document.addEventListener("pointerup", releasePointer, true);
  document.addEventListener("pointercancel", releasePointer, true);
  window.addEventListener("blur", releasePointer);

  function whenSettled(callback) {
    var startedAt = Date.now();
    (function check() {
      var settled = !pointerDown && Date.now() - lastPointerUp >= SETTLE_MS;
      if (settled || Date.now() - startedAt >= SETTLE_MAX_MS) {
        callback();
        return;
      }
      window.setTimeout(check, 100);
    })();
  }

  function exportProject(requestId) {
    whenSettled(function () {
      saveProject(requestId);
    });
  }

  function saveProject(requestId) {
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
      loadProject(data.sb3, data.mode, data.view);
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
