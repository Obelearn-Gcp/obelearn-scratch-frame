(function () {
  "use strict";

  function memoryStorage() {
    var data = new Map();
    return {
      get length() {
        return data.size;
      },
      key: function (index) {
        return Array.from(data.keys())[index] === undefined ? null : Array.from(data.keys())[index];
      },
      getItem: function (key) {
        return data.has(String(key)) ? data.get(String(key)) : null;
      },
      setItem: function (key, value) {
        data.set(String(key), String(value));
      },
      removeItem: function (key) {
        data.delete(String(key));
      },
      clear: function () {
        data.clear();
      }
    };
  }

  ["localStorage", "sessionStorage"].forEach(function (name) {
    try {
      window[name].getItem("");
    } catch (error) {
      Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
    }
  });

  try {
    void document.cookie;
  } catch (error) {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: function () {
        return "";
      },
      set: function () {}
    });
  }
})();
