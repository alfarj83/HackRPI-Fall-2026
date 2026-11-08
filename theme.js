// Runs before the page paints so there is no light/dark flash. Classic script (not a
// module) because it has to run synchronously from <head>. Extension pages cannot use
// inline scripts, so it lives in its own file.
(function () {
  var theme = null;
  try { theme = localStorage.getItem("headInTheClouds.theme"); } catch (e) { /* storage blocked */ }
  if (theme !== "light" && theme !== "dark") {
    theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
