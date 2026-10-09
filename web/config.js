/* Repozytorium z danymi (data/health.json).
   Aplikacja czyta stąd, gdziekolwiek jest otwarta: GitHub Pages, localhost, IntelliJ, Netlify.
   Tokenu tu NIE wpisuj: ten plik jest publiczny. Token wkleja się w ustawieniach aplikacji
   i zostaje tylko w przeglądarce. */
window.APP_CONFIG = {
  owner: 'MaciejPrzystarz',
  repo: 'dziennik-formy',
  branch: 'main',
  dataPath: 'data/health.json',
  staging: 'bufor' // tu zapisuje aplikacja i Claude; do main co niedzielę o 10:00 (.github/workflows/weekly.yml)
};
