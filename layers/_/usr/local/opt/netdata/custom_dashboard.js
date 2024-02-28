(() => {
  const key = "netdataTheme";
  if (!localStorage.getItem(key)) {
    localStorage.setItem(key, "White");
    location.reload();
  }
})();
