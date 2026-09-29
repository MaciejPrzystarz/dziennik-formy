/* Repozytorium z danymi (data/health.json).
   Na GitHub Pages pod adresem https://<login>.github.io/<repo>/ aplikacja rozpozna repo sama,
   więc owner i repo mogą zostać puste. Uzupełnij je, jeśli otwierasz aplikację gdzie indziej
   (Netlify, localhost, IntelliJ). Tokenu tu NIE wpisuj: ten plik jest publiczny.
   Token wkleja się w ustawieniach aplikacji i zostaje tylko w przeglądarce. */
window.APP_CONFIG = {
  owner: '',                  // login na GitHubie
  repo: '',                   // np. 'dziennik-formy'
  branch: 'main',
  dataPath: 'data/health.json'
};
