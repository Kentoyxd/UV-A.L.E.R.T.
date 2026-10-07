// Loader for the official Firebase Messaging compat build (v12.19.0).
// Works in both the page (security.html) and the service worker.
//
// To bundle it locally instead (recommended for offline use), replace this
// whole file with the contents of:
//   https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js
(function () {
  var URL = "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js";
  if (typeof importScripts === "function") {
    importScripts(URL);
  } else {
    document.write('<script src="' + URL + '"><\/script>');
  }
})();